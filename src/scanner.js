import { isIP } from 'node:net';
import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { OBSERVATION_STATES, validateDependencyEdge, validateEvidence } from './evidence.js';

const MAX_BODY_BYTES = 1_000_000;
const MAX_OBSERVED_SURFACES = 100;
const MAX_OBSERVED_RESOURCES = 250;
const MAX_REDIRECTS = 5;
const REQUEST_TIMEOUT_MS = 10_000;

const HOST_FINGERPRINTS = Object.freeze([
  {
    suffix: 'itsfogo.com',
    provider: 'Entain',
    capability: 'Sportsbook/Platform',
    component: 'Shared application runtime',
    resourceMatch: (resource) =>
      resource.attribute === 'src' &&
      /^(?:scmedia|scmedia-us)\.itsfogo\.com$/i.test(resource.hostname) &&
      /^\/\$-\$\/[0-9a-f]{32}\.js(?:\?|$)/i.test(resource.path)
  },
  {
    suffix: 'playngonetwork.com',
    provider: "Play'n GO",
    capability: 'Game Provider/RGS',
    component: 'Game delivery network',
    resourceMatch: (resource) => resource.attribute === 'src' && /(^|\/)casino\/game(?:\/|$)/i.test(resource.path)
  }
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

function normalizeIpv6(address) {
  try {
    const hostname = new URL(`http://[${address}]/`).hostname;
    return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1).toLowerCase() : null;
  } catch {
    return null;
  }
}

function mappedIpv4FromIpv6(address) {
  const value = normalizeIpv6(address) || String(address || '').toLowerCase();
  if (!value.startsWith('::ffff:')) return null;
  const tail = value.slice('::ffff:'.length);
  if (isIP(tail) === 4) return tail;
  const words = tail.split(':');
  if (words.length !== 2 || words.some((word) => !/^[0-9a-f]{1,4}$/.test(word))) return null;
  const high = Number.parseInt(words[0], 16);
  const low = Number.parseInt(words[1], 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

function isPrivateIp(address) {
  if (!address || !isIP(address)) return true;
  if (address.includes(':')) {
    const mapped = mappedIpv4FromIpv6(address);
    if (mapped) return isPrivateIp(mapped);
    const value = normalizeIpv6(address);
    if (!value) return true;
    return value === '::' || value === '::1' || value.startsWith('::') ||
      value.startsWith('fc') || value.startsWith('fd') ||
      value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb') ||
      value.startsWith('ff') || value.startsWith('64:ff9b:') || value === '64:ff9b::' ||
      value.startsWith('100:') || value.startsWith('2001::') || value.startsWith('2001:2:') ||
      value.startsWith('2001:db8:') || value === '2001:db8::' || value.startsWith('2002:');
  }
  const parts = address.split('.').map(Number);
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && parts[2] === 100) || (a === 203 && b === 0 && parts[2] === 113) || a >= 224;
}

async function resolvePublicTarget(url, lookupImpl = dnsLookup) {
  const normalized = normalizeTarget(url.href);
  const answers = await lookupImpl(normalized.hostname, { all: true, verbatim: true });
  if (!Array.isArray(answers) || answers.length === 0) throw new Error('target DNS resolution returned no addresses');
  if (answers.some((answer) => isPrivateIp(answer?.address))) throw new Error('target resolves to a non-public address');
  const addresses = [...new Set(answers.map((answer) => answer.address).filter(Boolean))];
  if (addresses.length === 0) throw new Error('target DNS resolution returned no usable addresses');
  return { url: normalized, addresses };
}

async function assertPublicResolution(url, lookupImpl = dnsLookup) {
  const resolved = await resolvePublicTarget(url, lookupImpl);
  return resolved.url;
}

function responseHeaders(headers) {
  return { get(name) { const value = headers[String(name).toLowerCase()]; return Array.isArray(value) ? value.join(', ') : value ?? null; } };
}

function requestPinnedAddress(url, address) {
  return new Promise((resolve, reject) => {
    const requestImpl = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const headers = {
      host: url.port ? `${url.hostname}:${url.port}` : url.hostname,
      'user-agent': 'iGaming-Radar-FreeScan/0.1 (+public-observation-only)',
      accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8'
    };
    const request = requestImpl({
      protocol: url.protocol,
      hostname: address,
      family: isIP(address),
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      headers,
      servername: url.protocol === 'https:' ? url.hostname : undefined,
      rejectUnauthorized: true
    }, (incoming) => {
      let consumed = false;
      resolve({
        url: url.href,
        status: incoming.statusCode || 0,
        ok: (incoming.statusCode || 0) >= 200 && (incoming.statusCode || 0) < 300,
        headers: responseHeaders(incoming.headers),
        async text() {
          if (consumed) return '';
          consumed = true;
          const chunks = [];
          let bytes = 0;
          for await (const chunk of incoming) {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            const remaining = MAX_BODY_BYTES - bytes;
            if (remaining <= 0) break;
            chunks.push(buffer.subarray(0, remaining));
            bytes += Math.min(buffer.length, remaining);
            if (bytes >= MAX_BODY_BYTES) break;
          }
          if (!incoming.complete) incoming.destroy();
          return Buffer.concat(chunks).toString('utf8');
        },
        async discard() {
          if (consumed) return;
          consumed = true;
          incoming.resume();
        }
      });
    });
    request.setTimeout(REQUEST_TIMEOUT_MS, () => request.destroy(new Error('request_timeout')));
    request.on('error', reject);
    request.end();
  });
}

async function fetchPinnedTarget(url, addresses) {
  let lastError;
  for (const address of addresses) {
    try { return await requestPinnedAddress(url, address); }
    catch (error) { lastError = error; }
  }
  throw lastError || new Error('target_fetch_failed');
}

async function fetchPublicTarget(initialUrl, { fetchImpl, lookupImpl }) {
  let current = initialUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const resolved = await resolvePublicTarget(current, lookupImpl);
    const response = fetchImpl
      ? await fetchImpl(resolved.url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: { 'user-agent': 'iGaming-Radar-FreeScan/0.1 (+public-observation-only)' }
      })
      : await fetchPinnedTarget(resolved.url, resolved.addresses);
    if (![301, 302, 303, 307, 308].includes(response.status)) return { response, finalUrl: resolved.url };
    if (hop === MAX_REDIRECTS) throw new Error('too many redirects');
    const location = response.headers?.get?.('location');
    if (!location) throw new Error('redirect without location');
    current = normalizeTarget(new URL(location, resolved.url).href);
  }
  throw new Error('too many redirects');
}

function hostnameMatches(hostname, suffix) {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  const normalizedSuffix = suffix.toLowerCase();
  return host === normalizedSuffix || host.endsWith(`.${normalizedSuffix}`);
}

function resourceMatchesFingerprint(resource, fingerprint) {
  if (!hostnameMatches(resource.hostname, fingerprint.suffix)) return false;
  return typeof fingerprint.resourceMatch !== 'function' || fingerprint.resourceMatch(resource);
}

async function corroborateFingerprintResource(resource, fingerprint, { fetchImpl, lookupImpl }) {
  try {
    const requestedUrl = normalizeTarget(resource.url).href;
    const { response, finalUrl } = await fetchPublicTarget(new URL(requestedUrl), { fetchImpl, lookupImpl });
    const finalHost = finalUrl.hostname.toLowerCase().replace(/\.$/, '');
    const corroborated = response.ok === true && hostnameMatches(finalHost, fingerprint.suffix);
    const observation = corroborated ? {
      requestedUrl,
      finalUrl: finalUrl.href,
      finalHostname: finalHost,
      httpStatus: response.status
    } : null;
    if (typeof response.discard === 'function') await response.discard();
    else if (response.body && typeof response.body.cancel === 'function') {
      try { await response.body.cancel(); } catch { /* Best-effort cleanup only. */ }
    }
    return observation;
  } catch {
    return null;
  }
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

function inventoryExternalSurfaces(resources, operatorHostnames) {
  const internalHostnames = new Set((Array.isArray(operatorHostnames) ? operatorHostnames : [operatorHostnames])
    .filter(Boolean)
    .map((hostname) => String(hostname).toLowerCase().replace(/\.$/, '')));
  const surfaceMap = new Map();
  for (const resource of resources) {
    if (!resource.hostname || internalHostnames.has(resource.hostname)) continue;
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
    if (surface.sampleResources.length < 3) surface.sampleResources.push({ path: resource.path, attribute: resource.attribute });
  }
  return [...surfaceMap.values()];
}

function evidenceId(index) { return `ev-${String(index).padStart(4, '0')}`; }

export async function scanTarget(input, { fetchImpl, lookupImpl = dnsLookup, now = () => new Date() } = {}) {
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

  let html = '';
  try { html = (await response.text()).slice(0, MAX_BODY_BYTES); } catch { html = ''; }

  const resources = extractExternalResources(html, finalUrl);
  const observedSurfaces = inventoryExternalSurfaces(resources, [target.hostname, finalUrl.hostname]);
  const hostEvidence = [];
  const corroborationCache = new Map();
  for (const resource of resources) {
    for (const fingerprint of HOST_FINGERPRINTS) {
      if (!resourceMatchesFingerprint(resource, fingerprint)) continue;
      const cacheKey = `${fingerprint.suffix}|${resource.url}`;
      let corroboration = corroborationCache.get(cacheKey);
      if (corroboration === undefined) {
        corroboration = await corroborateFingerprintResource(resource, fingerprint, { fetchImpl, lookupImpl });
        corroborationCache.set(cacheKey, corroboration);
      }
      if (corroboration) {
        hostEvidence.push({
          ...fingerprint,
          resourceMatch: undefined,
          locator: corroboration.requestedUrl,
          evidenceClass: 'runtime_resource_http',
          rawSignal: `HTTP ${corroboration.httpStatus}`,
          corroboration
        });
      }
    }
  }

  const unique = new Map();
  for (const signal of hostEvidence) unique.set(`${signal.provider}|${signal.capability}|${signal.component}|${signal.locator}|${signal.evidenceClass}`, signal);

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
      live: true,
      ...(signal.corroboration ? {
        requestedUrl: signal.corroboration.requestedUrl,
        finalUrl: signal.corroboration.finalUrl,
        finalHostname: signal.corroboration.finalHostname,
        httpStatus: signal.corroboration.httpStatus
      } : {})
    };
    if (!validateEvidence(record).ok) continue;
    evidence.push(record);
    const edge = { operator: target.hostname, capability: signal.capability, provider: signal.provider, component: signal.component, confidence: 'LOW', evidenceIds: [id] };
    if (validateDependencyEdge(edge, new Map(evidence.map((item) => [item.id, item]))).ok) edges.push(edge);
  }

  if (edges.length === 0) return { target: target.hostname, state: OBSERVATION_STATES.NOT_OBSERVABLE, reason: response.ok ? 'no_supported_dependency_signal' : `http_${response.status}`, evidence: [], dependencies: [], observedSurfaces };
  return { target: target.hostname, state: OBSERVATION_STATES.OBSERVED, scannedUrl: finalUrl.href, evidence, dependencies: edges, observedSurfaces };
}

export { assertPublicResolution, corroborateFingerprintResource, extractExternalResources, extractHostnames, fetchPublicTarget, hostnameMatches, inventoryExternalSurfaces, isPrivateIp, mappedIpv4FromIpv6, normalizeTarget, resourceMatchesFingerprint, HOST_FINGERPRINTS };