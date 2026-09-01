import { classifyDomainLanding } from './revenue-path.js';
import { fetchPublicTarget, normalizeTarget } from './scanner.js';

const MAX_BODY_BYTES = 250_000;
const MAX_ASSETS = 5;
const MAX_MARKERS = 8;
const CORROBORATION_FRESHNESS_MS = 15 * 60 * 1000;

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
function criticalAssetFailureSignature(observations) {
  if (observations?.criticalAssets !== 'broken' || !Array.isArray(observations?.criticalAssetEvidence)) return null;
  const broken = observations.criticalAssetEvidence
    .filter((item) => item?.state === 'BROKEN' && typeof item?.requestedUrl === 'string' && Number.isInteger(item?.httpStatus))
    .map((item) => `${item.requestedUrl}:${item.httpStatus}`)
    .sort();
  return broken.length > 0 ? `asset:${broken.join('|')}` : null;
}
function failureEvidence(observations, context = {}) {
  if (observations?.dns === 'fail') return { signature: 'dns:fail', confirmationField: 'dnsConfirmations' };
  if (observations?.tls === 'fail') return { signature: 'tls:fail', confirmationField: 'tlsConfirmations' };
  if (Number.isInteger(observations?.http) && observations.http >= 500 && observations.http <= 599) return { signature: `http:${observations.http}`, confirmationField: 'http5xxConfirmations' };
  if ([403, 451].includes(observations?.http)) return { signature: `access:${observations.http}:${observations.page ?? 'unknown'}`, confirmationField: 'accessConfirmations' };
  if (observations?.http === 200 && observations?.page === 'error-template') return { signature: 'page:200:error-template', confirmationField: 'pageConfirmations' };
  const assetSignature = criticalAssetFailureSignature(observations);
  if (assetSignature) return { signature: assetSignature, confirmationField: 'criticalAssetConfirmations' };
  if (observations?.cta === 'missing' && context.ctaCritical === true) {
    const markers = limitedStrings(context.ctaMarkers).map((marker) => marker.toLowerCase()).sort();
    return { signature: `cta:missing:${markers.join('|')}`, confirmationField: 'ctaConfirmations' };
  }
  return null;
}
function applyTrustedSequentialCorroboration(observations, previous, { target, geo, observedAt, ctaCritical = false, ctaMarkers = [] }) {
  const failure = failureEvidence(observations, { ctaCritical, ctaMarkers });
  if (!failure) return { observations, failureSignature: null, failureConfirmations: 0 };

  const currentMs = new Date(observedAt).getTime();
  const previousMs = new Date(previous?.observedAt ?? '').getTime();
  const previousCount = Number.isInteger(previous?.failureConfirmations) && previous.failureConfirmations >= 1 ? previous.failureConfirmations : 1;
  const previousIsTrusted = previous?.geoProvenance === 'TRUSTED_RUNTIME_VANTAGE';
  const sameTargetGeo = previous?.target === target && previous?.geo === geo;
  const sameFailure = previous?.failureSignature === failure.signature;
  const freshSequential = Number.isFinite(currentMs) && Number.isFinite(previousMs) && currentMs > previousMs && currentMs - previousMs <= CORROBORATION_FRESHNESS_MS;
  const confirmations = previousIsTrusted && sameTargetGeo && sameFailure && freshSequential ? previousCount + 1 : 1;

  return {
    observations: { ...observations, [failure.confirmationField]: confirmations },
    failureSignature: failure.signature,
    failureConfirmations: confirmations
  };
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

export async function probeDomainLanding(input, { fetchImpl, lookupImpl, now = () => new Date(), trustedControls = [], trustedPreviousObservation = null } = {}) {
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
    const rawObservations = { probeContext: 'automated', ...classifyTransportError(error) };
    const corroboration = applyTrustedSequentialCorroboration(rawObservations, trustedPreviousObservation, { target: target.href, geo, observedAt, ctaCritical: config.ctaCritical === true, ctaMarkers });
    const observations = corroboration.observations;
    const classified = classifyDomainLanding({ geo, observations, controls, config: { ctaCritical: config.ctaCritical === true }, evidenceClass: 'LIVE_OBSERVED' });
    const ambiguousTransport = observations.transport === 'fail';
    return { target: target.href, observedAt, state: ambiguousTransport ? 'NOT_OBSERVABLE' : classified.state, scope: ambiguousTransport ? 'probe-transport-ambiguous' : classified.scope, cause: 'NOT_OBSERVABLE', attribution: 'Not observable externally', dependencyEdges: 0, evidence: classified.evidence, failureSignature: corroboration.failureSignature, failureConfirmations: corroboration.failureConfirmations, transportError: String(error?.message || 'probe_failed').slice(0, 160), roiProof: { status: 'NOT_CLAIMED', savedGgr: null, savedRevenue: null } };
  }
  const body = await readBoundedText(response);
  const rawObservations = { probeContext: 'automated', dns: 'ok', tls: finalUrl.protocol === 'https:' ? 'ok' : 'not_applicable', http: response.status, redirect: finalUrl.href === target.href ? 'none' : 'followed' };
  if ([403, 451].includes(response.status)) rawObservations.page = challengeMarkers.length > 0 && hasAnyMarker(body, challengeMarkers) ? 'challenge' : 'unavailable';
  else if (response.status === 200 && errorMarkers.length > 0 && hasAnyMarker(body, errorMarkers)) rawObservations.page = 'error-template';
  else rawObservations.page = 'content';
  if (criticalAssetUrls.length > 0) { const assetResult = await probeCriticalAssets(criticalAssetUrls, transport); rawObservations.criticalAssets = assetResult.state; rawObservations.criticalAssetEvidence = assetResult.evidence; }
  if (ctaMarkers.length > 0) rawObservations.cta = hasAnyMarker(body, ctaMarkers) ? 'present' : 'missing';
  const corroboration = applyTrustedSequentialCorroboration(rawObservations, trustedPreviousObservation, { target: target.href, geo, observedAt, ctaCritical: config.ctaCritical === true, ctaMarkers });
  const observations = corroboration.observations;
  const classified = classifyDomainLanding({ geo, observations, controls, config: { ctaCritical: config.ctaCritical === true }, evidenceClass: 'LIVE_OBSERVED' });
  return { target: target.href, finalUrl: finalUrl.href, observedAt, state: classified.state, scope: classified.scope, cause: classified.cause, attribution: classified.attributable ? 'Inferred' : 'Not observable externally', dependencyEdges: classified.dependencyEdges, evidence: classified.evidence, failureSignature: corroboration.failureSignature, failureConfirmations: corroboration.failureConfirmations, roiProof: { status: 'NOT_CLAIMED', savedGgr: null, savedRevenue: null } };
}
