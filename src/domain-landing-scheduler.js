import { runDomainLandingCycle } from './domain-landing-cycle.js';
import { bindTrustedProbeVantage } from './probe-vantage.js';
import { assembleTrustedDomainLandingControls } from './domain-landing-controls.js';

export async function runDomainLandingBatch({
  targetStore,
  lifecycleStore,
  env = process.env,
  now = () => new Date(),
  limit = 20,
  runCycle = runDomainLandingCycle,
  bindVantage = bindTrustedProbeVantage
} = {}) {
  if (!targetStore || typeof targetStore.list !== 'function' || typeof targetStore.markRun !== 'function') throw new Error('TARGET_STORE_REQUIRED');
  if (!lifecycleStore || typeof lifecycleStore.get !== 'function' || typeof lifecycleStore.compareAndSet !== 'function') throw new Error('LIFECYCLE_STORE_REQUIRED');

  const targets = await targetStore.list({ enabledOnly: true, limit });
  const results = [];

  for (const target of targets) {
    const runAt = now().toISOString();
    try {
      const vantage = bindVantage({ scopeId: target.scopeId, target: target.target, geo: target.requestedGeo, requestedGeo: target.requestedGeo, recoveryConfirmations: target.recoveryConfirmations, config: target.config ?? {} }, env);
      if (!vantage.geoMatch) throw Object.assign(new Error('GEO_VANTAGE_UNAVAILABLE'), { requestedGeo: vantage.requestedGeo, trustedGeo: vantage.trustedGeo, executionRegion: vantage.executionRegion, geoProvenance: vantage.geoProvenance });

      const persistedObservations = typeof lifecycleStore.listObservations === 'function' ? await lifecycleStore.listObservations(target.scopeId) : [];
      const trustedControls = assembleTrustedDomainLandingControls({ observations: persistedObservations, scopeId: target.scopeId, target: target.target, geo: vantage.trustedGeo, controlGroup: target.config?.controlGroup ?? null, now: new Date(runAt) });
      const result = await runCycle(vantage.payload, { lifecycleStore, store: lifecycleStore, now: () => new Date(runAt), trustedControls });

      if (typeof lifecycleStore.recordObservation === 'function' && result.probe?.observedAt && result.probe?.state) {
        await lifecycleStore.recordObservation({ scopeId: target.scopeId, target: result.probe.target ?? target.target, geo: result.geo, state: result.probe.state, observedAt: result.probe.observedAt, geoProvenance: vantage.geoProvenance, controlGroup: target.config?.controlGroup ?? null });
      }

      await targetStore.markRun(target.id, { at: runAt, status: 'SUCCESS' });
      results.push({ id: target.id, target: target.target, requestedGeo: vantage.requestedGeo, observedGeo: result.geo, executionRegion: vantage.executionRegion, geoProvenance: vantage.geoProvenance, state: result.lifecycle?.state ?? result.probe?.state ?? 'NOT_OBSERVABLE', alertEvent: result.alert?.event ?? null, trustedControlCount: trustedControls.length, status: 'SUCCESS' });
    } catch (error) {
      await targetStore.markRun(target.id, { at: runAt, status: 'FAILED' });
      results.push({ id: target.id, target: target.target, requestedGeo: error?.requestedGeo ?? target.requestedGeo ?? 'UNKNOWN', observedGeo: error?.trustedGeo && error.trustedGeo !== 'UNKNOWN' ? error.trustedGeo : null, executionRegion: error?.executionRegion ?? null, geoProvenance: error?.geoProvenance ?? null, state: 'NOT_OBSERVABLE', alertEvent: null, status: 'FAILED', error: error?.message ?? 'domain_landing_batch_target_failed' });
    }
  }

  return { contract: 'domain-landing-batch/v1', attempted: results.length, succeeded: results.filter((item) => item.status === 'SUCCESS').length, failed: results.filter((item) => item.status === 'FAILED').length, results, roiProof: { status: 'NOT_CLAIMED', savedGgr: null, savedRevenue: null } };
}
