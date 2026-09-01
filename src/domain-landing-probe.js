import { classifyDomainLanding } from './revenue-path.js';
import { fetchPublicTarget, normalizeTarget } from './scanner.js';

const MAX_BODY_BYTES = 250_000;
const MAX_ASSETS = 5;
const MAX_MARKERS = 8;

function limitedStrings(values, limit = MAX_MARKERS) {
  if (!Array.isArray(values)) return [];
  return values.filter((value) => typeof value === 'string' && value.length > 0 && value.length <= 256).slice(0, limit);
}
function hasAnyMarker(body, markers) { const haystack = String(body || '').toLowerCase(); return markers.some((marker) => haystack.includes(marker.toLowerCase())); }
function classifyTransportError(error) {
  const message = String(error?.message || '').toLowerCase();
  if (message.includes('too many redirects')) return { redirect: 'loop' };
  if (message.includes('dns') || message.includes('resolution') || message.includes('non-public address')) return { dns: 'fail' };
  if (message.includes('certificate') || message.includes('cert_') || message.includes('tls') || message.includes('ssl') || message.includes('self signed')) return { dns: 'ok', tls: 'fail' };
  return { transport: 'fail' };
}
async function readBoundedText(response) { const text = await response.text(); return String(text || '').slice(0, MAX_BODY_BYTES); }
async function probeCriticalAssets(assetUrls, transport) {
  const evidence = []; let observedBroken = false; let observedHealthy = false;
  for (const assetUrl of assetUrls.slice(0, MAX_ASSETS)) {
    try {
      const target = normalizeTarget(assetUrl); const { response, finalUrl } = await fetchPublicTarget(target, transport);
      if (typeof response.discard === 'function') await response.discard();
      const ok = response.status >= 200 && response.status < 400;
      evidence.push({ requestedUrl: target.href, finalUrl: finalUrl.href, httpStatus: response.status, state: ok ? 'HEALTHY' : 'BROKEN', provenance: 'Observed' });
      if (ok) observedHealthy = true; else observedBroken = true;
    } catch (error) { evidence.push({ requestedUrl: assetUrl, state: 'NOT_OBSERVABLE', provenance: 'Not observable externally', detail: String(error?.message || 'asset_probe_failed').slice(0, 160) }); }
  }
  return { state: observedBroken ? 'broken' : observedHealthy ? 'healthy' : 'not_observable', evidence };
}

export async function probeDomainLanding(input, { fetchImpl, lookupImpl, now = () => new Date(), trustedControls = [] } = {}) {
  if (!input || typeof input.target !== 'string' || input.target.trim() === '') throw Object.assign(new Error('target_required'), { statusCode: 400 });
  const target = normalizeTarget(input.target.trim());
  const geo = typeof input.geo === 'string' && input.geo.trim() ? input.geo.trim().toUpperCase().slice(0, 16) : 'UNKNOWN';
  const config = input.config && typeof input.config === 'object' ? input.config : {};
  const controls = Array.isArray(trustedControls) ? trustedControls : [];
  const ctaMarkers = limitedStrings(config.ctaMarkers); const errorMarkers = limitedStrings(config.errorMarkers); const challengeMarkers = limitedStrings(config.challengeMarkers); const criticalAssetUrls = limitedStrings(config.criticalAssetUrls, MAX_ASSETS);
  const transport = { fetchImpl, lookupImpl }; const observedAt = now().toISOString();
  let response; let finalUrl;
  try { ({ response, finalUrl } = await fetchPublicTarget(target, transport)); }
  catch (error) {
    const observations = { probeContext: 'automated', ...classifyTransportError(error) };
    const classified = classifyDomainLanding({ geo, observations, controls, config: { ctaCritical: config.ctaCritical === true }, evidenceClass: 'LIVE_OBSERVED' });
    const ambiguousTransport = observations.transport === 'fail';
    return { target: target.href, observedAt, state: ambiguousTransport ? 'NOT_OBSERVABLE' : classified.state, scope: ambiguousTransport ? 'probe-transport-ambiguous' : classified.scope, cause: 'NOT_OBSERVABLE', attribution: 'Not observable externally', dependencyEdges: 0, evidence: classified.evidence, transportError: String(error?.message || 'probe_failed').slice(0, 160), roiProof: { status: 'NOT_CLAIMED', savedGgr: null, savedRevenue: null } };
  }
  const body = await readBoundedText(response);
  const observations = { probeContext: 'automated', dns: 'ok', tls: finalUrl.protocol === 'https:' ? 'ok' : 'not_applicable', http: response.status, redirect: finalUrl.href === target.href ? 'none' : 'followed' };
  if ([403, 451].includes(response.status)) observations.page = challengeMarkers.length > 0 && hasAnyMarker(body, challengeMarkers) ? 'challenge' : 'unavailable';
  else if (response.status === 200 && errorMarkers.length > 0 && hasAnyMarker(body, errorMarkers)) observations.page = 'error-template';
  else observations.page = 'content';
  if (criticalAssetUrls.length > 0) { const assetResult = await probeCriticalAssets(criticalAssetUrls, transport); observations.criticalAssets = assetResult.state; observations.criticalAssetEvidence = assetResult.evidence; }
  if (ctaMarkers.length > 0) observations.cta = hasAnyMarker(body, ctaMarkers) ? 'present' : 'missing';
  const classified = classifyDomainLanding({ geo, observations, controls, config: { ctaCritical: config.ctaCritical === true }, evidenceClass: 'LIVE_OBSERVED' });
  return { target: target.href, finalUrl: finalUrl.href, observedAt, state: classified.state, scope: classified.scope, cause: classified.cause, attribution: classified.attributable ? 'Inferred' : 'Not observable externally', dependencyEdges: classified.dependencyEdges, evidence: classified.evidence, roiProof: { status: 'NOT_CLAIMED', savedGgr: null, savedRevenue: null } };
}
