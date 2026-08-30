import { isIP } from 'node:net';
import { OBSERVATION_STATES, validateDependencyEdge, validateEvidence } from './evidence.js';

const MAX_BODY_BYTES = 1_000_000;
const MAX_OBSERVED_SURFACES = 100;

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

function hostnameMatches(hostname, suffix) {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  const normalizedSuffix = suffix.toLowerCase();
  return host === normalizedSuffix || host.endsWith(`.${normalizedSuffix}`);
}

function extractHostnames(html, baseUrl) {
  const hosts = new Set();
  const pattern = /(?:src|href)\s*=\s*["']([^"']+)["']/gi;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    try {
      const url = new URL(match[1], baseUrl);
      if (['http:', 'https:'].includes(url.protocol)) hosts.add(url.hostname.toLowerCase());
    } catch {
      // Ignore malformed public markup; never turn it into evidence.
    }
  }
  return [...hosts];
}

function inventoryExternalSurfaces(hostnames, operatorHostname) {
  return [...new Set(hostnames)]
    .filter((hostname) => hostname && hostname !== operatorHostname)
    .slice(0, MAX_OBSERVED_SURFACES)
    .map((hostname) => ({
      hostname,
      state: OBSERVATION_STATES.OBSERVED,
      attribution: 'UNATTRIBUTED',
      evidenceClass: 'html_external_hostname'
    }));
}

function evidenceId(index) {
  return `ev-${String(index).padStart(4, '0')}`;
}

export async function scanTarget(input, { fetchImpl = globalThis.fetch, now = () => new Date() } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is required');
  const target = normalizeTarget(input);
  const observedAt = now().toISOString();
  const evidence = [];
  const edges = [];

  let response;
  try {
    response = await fetchImpl(target, {
      redirect: 'follow',
      signal: AbortSignal.timeout(10_000),
      headers: { 'user-agent': 'iGaming-Radar-FreeScan/0.1 (+public-observation-only)' }
    });
  } catch (error) {
    return {
      target: target.hostname,
      state: OBSERVATION_STATES.NOT_OBSERVABLE,
      reason: 'target_fetch_failed',
      detail: error?.name || 'fetch_error',
      evidence: [],
      dependencies: [],
      observedSurfaces: []
    };
  }

  const finalUrl = new URL(response.url || target.href);
  const headerEvidence = [];
  const cfRay = response.headers?.get?.('cf-ray');
  if (cfRay) {
    headerEvidence.push({
      provider: 'Cloudflare', capability: 'CDN/Cloud', component: 'Edge/CDN',
      locator: finalUrl.href, evidenceClass: 'http_response_header', rawSignal: 'cf-ray'
    });
  }

  let html = '';
  try {
    const raw = await response.text();
    html = raw.slice(0, MAX_BODY_BYTES);
  } catch {
    html = '';
  }

  const extractedHostnames = extractHostnames(html, finalUrl);
  const observedSurfaces = inventoryExternalSurfaces(extractedHostnames, target.hostname);
  const hostEvidence = [];
  for (const hostname of extractedHostnames) {
    for (const fingerprint of HOST_FINGERPRINTS) {
      if (hostnameMatches(hostname, fingerprint.suffix)) {
        hostEvidence.push({ ...fingerprint, locator: hostname, evidenceClass: 'html_external_hostname', rawSignal: fingerprint.suffix });
      }
    }
  }

  const unique = new Map();
  for (const signal of [...headerEvidence, ...hostEvidence]) {
    const key = `${signal.provider}|${signal.capability}|${signal.component}|${signal.locator}|${signal.evidenceClass}`;
    unique.set(key, signal);
  }

  let index = 1;
  for (const signal of unique.values()) {
    const id = evidenceId(index++);
    const record = {
      id,
      sourceId: `${signal.evidenceClass}:${signal.locator}`,
      observedAt,
      locator: signal.locator,
      evidenceClass: signal.evidenceClass,
      state: OBSERVATION_STATES.OBSERVED,
      rawSignal: signal.rawSignal,
      live: true
    };
    const validation = validateEvidence(record);
    if (!validation.ok) continue;
    evidence.push(record);

    const edge = {
      operator: target.hostname,
      capability: signal.capability,
      provider: signal.provider,
      component: signal.component,
      confidence: 'LOW',
      evidenceIds: [id]
    };
    const edgeValidation = validateDependencyEdge(edge, new Map(evidence.map((item) => [item.id, item])));
    if (edgeValidation.ok) edges.push(edge);
  }

  if (edges.length === 0) {
    return {
      target: target.hostname,
      state: OBSERVATION_STATES.NOT_OBSERVABLE,
      reason: response.ok ? 'no_supported_dependency_signal' : `http_${response.status}`,
      evidence: [],
      dependencies: [],
      observedSurfaces
    };
  }

  return {
    target: target.hostname,
    state: OBSERVATION_STATES.OBSERVED,
    scannedUrl: finalUrl.href,
    evidence,
    dependencies: edges,
    observedSurfaces
  };
}

export { extractHostnames, hostnameMatches, inventoryExternalSurfaces, normalizeTarget, HOST_FINGERPRINTS };
