import { probeDomainLanding } from './domain-landing-probe.js';
import { advanceRevenuePathLifecycle, initialRevenuePathLifecycle } from './revenue-path.js';
import { buildRevenuePathAlert } from './revenue-path-alert.js';

function toClassified(probe) {
  return { state: probe.state, scope: probe.scope, cause: probe.cause ?? 'NOT_OBSERVABLE', attributable: false, dependencyEdges: 0, evidence: probe.evidence };
}

export async function runDomainLandingCycle(input, {
  store,
  probeImpl = probeDomainLanding,
  now = () => new Date(),
  maxCasAttempts = 3,
  trustedControls = [],
  trustedPreviousObservation = null,
  observationContext = null
} = {}) {
  if (!store || typeof store.get !== 'function' || typeof store.compareAndSet !== 'function') throw new Error('DURABLE_STORE_REQUIRED');
  if (!input || typeof input.scopeId !== 'string' || input.scopeId.length === 0) throw Object.assign(new Error('scope_id_required'), { statusCode: 400 });
  if (typeof input.target !== 'string' || input.target.length === 0) throw Object.assign(new Error('target_required'), { statusCode: 400 });

  const observedAt = now().toISOString();
  const probe = await probeImpl(input, { now: () => new Date(observedAt), trustedControls, trustedPreviousObservation });
  const geo = probe?.evidence?.geo ?? input.geo ?? 'UNKNOWN';
  const classified = toClassified(probe);
  const observation = observationContext?.geoProvenance && probe?.observedAt && probe?.state ? {
    scopeId: input.scopeId,
    target: probe.target,
    geo,
    state: probe.state,
    observedAt: probe.observedAt,
    geoProvenance: observationContext.geoProvenance,
    controlGroup: observationContext.controlGroup ?? null,
    failureSignature: probe.failureSignature ?? null,
    failureConfirmations: probe.failureConfirmations ?? 0
  } : null;

  for (let attempt = 0; attempt < maxCasAttempts; attempt += 1) {
    const currentRecord = await store.get(input.scopeId, probe.target, geo);
    const currentLifecycle = currentRecord?.lifecycle ?? initialRevenuePathLifecycle();
    const lifecycle = advanceRevenuePathLifecycle(currentLifecycle, classified, probe.observedAt ?? observedAt, { recoveryConfirmations: input.recoveryConfirmations ?? 2 });
    const useAtomicObservation = observation && typeof store.compareAndSetWithObservation === 'function';
    const stored = useAtomicObservation
      ? await store.compareAndSetWithObservation(input.scopeId, probe.target, geo, currentRecord?.version ?? 0, lifecycle, observation)
      : await store.compareAndSet(input.scopeId, probe.target, geo, currentRecord?.version ?? 0, lifecycle);
    if (!stored) continue;

    const alert = buildRevenuePathAlert({ classified, lifecycle, target: probe.target, path: 'DOMAIN/LANDING', observedAt: probe.observedAt ?? observedAt, confidence: 'GUARDED' });
    return { contract: 'domain-landing-cycle/v1', target: probe.target, geo, probe, lifecycle, alert, observationPersistedAtomically: Boolean(useAtomicObservation), persistence: store.persistence ?? 'DURABLE_STORE', roiProof: { status: 'NOT_CLAIMED', savedGgr: null, savedRevenue: null } };
  }
  throw Object.assign(new Error('revenue_path_state_conflict'), { statusCode: 409 });
}
