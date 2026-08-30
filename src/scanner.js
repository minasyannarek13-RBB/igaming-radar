import { isIP } from 'node:net';
import { lookup as dnsLookup } from 'node:dns/promises';
import { OBSERVATION_STATES, validateDependencyEdge, validateEvidence } from './evidence.js';

const MAX_BODY_BYTES = 1_000_000;
const MAX_OBSERVED_SURFACES = 100;
const MAX_OBSERVED_RESOURCES = 250;
const MAX_REDIRECTS = 5;

const HOST_FINGERPRINTS = Object.freeze([
  { suffix: 'cloudfront.net', provider: 'Amazon CloudFront', capability: 'CDN/Cloud', component: 'CDN edge' },
  { suffix: 'akamaized.net', provider: 'Akamai', capability: 'CDN/Cloud', component: 'CDN edge' },
  { suffix: 'akamaihd.net', provider: 'Akamai', capability: 'CDN/Cloud', component: 'CDN edge' },
  { suffix: 'fastly.net', provider: 'Fastly', capability: 'CDN/Cloud', component: 'CDN edge' }
]);

function normalizeTarget(input) {
  if (typeof input !== 'string' || input.trim() === '') throw new Error('target is required');
  const candidate = /^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`;
  const url = new URL(candidate);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('only http/https targets are supported');
  if (url.username || url.password) throw new Error('target credentials are not supported');

  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  const ipCandidate = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new Error('target must be a public hostname');
  }
  if (isIP(ipCandidate)) throw new Error('IP literal targets are not supported');
  if (url.port && !['80', '443'].includes(url.port)) throw new Error('non-standard target ports are not supported');

  return url;
}

function isPrivateIp(address) {
  if (!address || !isIP(address)) return true;
  if (address.includes(':')) {
    const value = address.toLowerCase();
    return value === '::' || value === '::1' || value.startsWith('fc') || value.startsWith('fd') ||
      value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb') ||
      value.startsWith('ff') || value.startsWith('2001:db8:') || value.startsWith('::ffff:127.') ||
      value.startsWith('::ffff:10.') || value.startsWith('::ffff:192.168.') || value.startsWith('::ffff:169.254.');
  }
  const parts = address.split('.').map(Number);
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 192 && b === 0) || (a === 192 && b === 0 && parts[2] === 2) ||
    (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && parts[2] === 100) ||
    (a === 203 && b === 0 && parts[2] === 113) || a >= 224;
}

async function assertPublicResolution(url, lookupImpl = dnsLookup) {
  const normalized = normalizeTarget(url.href);
  const answers = await lookupImpl(normalized.hostname, { all: true, verbatim: true });
  if (!Array.isArray(answers) || answers.length === 0) throw new Error('target DNS resolution returned no addresses');
  if (answers.some((answer) => isPrivateIp(answer?.address))) throw new Error('target resolves to a non-public address');
  return normalized;
}

async function fetchPublicTarget(initialUrl, { fetchImpl, lookupImpl }) {
  let current = initialUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    await assertPublicResolution(current, lookupImpl);
    const response = await fetchImpl(current, {
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
      headers: { 'user-agent': 'iGaming-Radar-FreeScan/0.1 (+public-observation-only)' }
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) return { response, finalUrl: current };
    if (hop === MAX_REDIRECTS) throw new Error('too many redirects');
    const location = response.headers?.get?.('location');
    if (!location) throw new Error('redirect without location');
    current = normalizeTarget(new URL(location, current).href);
  }
  throw new Error('too many redirects');
}

function hostnameMatches(hostname, suffix) {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  const normalizedSuffix = suffix.toLowerCase();
  return host === normalizedSuffix || host.endsWith(`.${normalizedSuffix}`);
}

function extractExternalResources(html, baseUrl) {
  const resources = [];
  const seen = new Set();
  const pattern = /(src|href)\s*=\s*["']([^"']+)["']/gi;
  let match;
  while ((match = pattern.exec(html)) !== null && resources.length < MAX_OBSERVED_RESOURCES) {
    try {
      const url = new URL(match[2], baseUrl);
      if (!['http:', 'https:'].includes(url.protocol)) continue;
      const normalized = {
        url: url.href,
        hostname: url.hostname.toLowerCase().replace(/\.$/, ''),
        path: `${url.pathname}${url.search}`,
        attribute: match[1].toLowerCase()
      };
      const key = `${normalized.attribute}|${normalized.url}`;
      if (!seen.has(key)) {
        seen.add(key);
        resources.push(normalized);
      }
    } catch {
      // Ignore malformed public markup; never turn it into evidence.
    }
  }
  return resources;
}

function extractHostnames(html, baseUrl) {
  return [...new Set(extractExternalResources(html, baseUrl).map((resource) => resource.hostname))];
}

function inventoryExternalSurfaces(resources, operatorHostname) {
  const surfaceMap = new Map();
  for (const resource of resources) {
    if (!resource.hostname || resource.hostname === operatorHostname) continue;
    if (!surfaceMap.has(resource.hostname)) {
      if (surfaceMap.size >= MAX_OBSERVED_SURFACES) break;
      surfaceMap.set(resource.hostname, {
        hostname: resource.hostname,
        state: OBSERVATION_STATES.OBSERVED,
        attribution: 'UNATTRIBUTED',
        evidenceClass: 'html_external_hostname',
        sampleResources: []
      });
    }
    const surface = surfaceMap.get(resource.hostname);
    if (surface.sampleResources.length < 3) {
      surface.sampleResources.push({ path: resource.path, attribute: resource.attribute });
    }
  }
  return [...surfaceMap.values()];
}

function evidenceId(index) { return `ev-${String(index).padStart(4, '0')}`; }

export async function scanTarget(input, { fetchImpl = globalThis.fetch, lookupImpl = dnsLookup, now = () => new Date() } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is required');
  const target = normalizeTarget(input);
  const observedAt = now().toISOString();
  const evidence = [];
  const edges = [];

  let response;
  let finalUrl;
  try {
    ({ response, finalUrl } = await fetchPublicTarget(target, { fetchImpl, lookupImpl }));
  } catch (error) {
    return { target: target.hostname, state: OBSERVATION_STATES.NOT_OBSERVABLE, reason: 'target_fetch_failed', detail: error?.message || error?.name || 'fetch_error', evidence: [], dependencies: [], observedSurfaces: [] };
  }

  const headerEvidence = [];
  const cfRay = response.headers?.get?.('cf-ray');
  if (cfRay) headerEvidence.push({ provider: 'Cloudflare', capability: 'CDN/Cloud', component: 'Edge/CDN', locator: finalUrl.href, evidenceClass: 'http_response_header', rawSignal: 'cf-ray' });

  let html = '';
  try { html = (await response.text()).slice(0, MAX_BODY_BYTES); } catch { html = ''; }

  const resources = extractExternalResources(html, finalUrl);
  const observedSurfaces = inventoryExternalSurfaces(resources, target.hostname);
  const hostEvidence = [];
  for (const resource of resources) {
    for (const fingerprint of HOST_FINGERPRINTS) {
      if (hostnameMatches(resource.hostname, fingerprint.suffix)) {
        hostEvidence.push({ ...fingerprint, locator: resource.hostname, evidenceClass: 'html_external_hostname', rawSignal: fingerprint.suffix });
      }
    }
  }

  const unique = new Map();
  for (const signal of [...headerEvidence, ...hostEvidence]) unique.set(`${signal.provider}|${signal.capability}|${signal.component}|${signal.locator}|${signal.evidenceClass}`, signal);

  let index = 1;
  for (const signal of unique.values()) {
    const id = evidenceId(index++);
    const record = { id, sourceId: `${signal.evidenceClass}:${signal.locator}`, observedAt, locator: signal.locator, evidenceClass: signal.evidenceClass, state: OBSERVATION_STATES.OBSERVED, rawSignal: signal.rawSignal, live: true };
    if (!validateEvidence(record).ok) continue;
    evidence.push(record);
    const edge = { operator: target.hostname, capability: signal.capability, provider: signal.provider, component: signal.component, confidence: 'LOW', evidenceIds: [id] };
    if (validateDependencyEdge(edge, new Map(evidence.map((item) => [item.id, item]))).ok) edges.push(edge);
  }

  if (edges.length === 0) return { target: target.hostname, state: OBSERVATION_STATES.NOT_OBSERVABLE, reason: response.ok ? 'no_supported_dependency_signal' : `http_${response.status}`, evidence: [], dependencies: [], observedSurfaces };
  return { target: target.hostname, state: OBSERVATION_STATES.OBSERVED, scannedUrl: finalUrl.href, evidence, dependencies: edges, observedSurfaces };
}

export { assertPublicResolution, extractExternalResources, extractHostnames, fetchPublicTarget, hostnameMatches, inventoryExternalSurfaces, isPrivateIp, normalizeTarget, HOST_FINGERPRINTS };
