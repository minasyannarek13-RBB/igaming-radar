import test from 'node:test';
import assert from 'node:assert/strict';
import { runDomainLandingBatch } from '../src/domain-landing-scheduler.js';
import { runDomainLandingCycle } from '../src/domain-landing-cycle.js';
import { probeDomainLanding } from '../src/domain-landing-probe.js';

const target = { id: 'redirect-loop', scopeId: 'tenant-a', target: 'https://operator.example/', requestedGeo: 'DE', enabled: true, recoveryConfirmations: 2, config: {} };
const targetStore = { async list() { return [target]; }, async markRun() {} };
const lookupImpl = async () => [{ address: '93.184.216.34', family: 4 }];
function redirectResponse() {
  return { status: 302, ok: false, headers: { get(name) { return name.toLowerCase() === 'location' ? '/' : null; } }, async text() { return ''; }, async discard() {} };
}
function redirectLoopCycle(input, options) {
  return runDomainLandingCycle(input, {
    ...options,
    probeImpl: (probeInput, probeOptions) => probeDomainLanding(probeInput, { ...probeOptions, lookupImpl, fetchImpl: async () => redirectResponse() })
  });
}
function memoryStore() {
  const lifecycle = new Map();
  const observations = new Map();
  return {
    persistence: 'TEST_DURABLE_STORE',
    async get(scopeId, url, geo) { return lifecycle.get(`${scopeId}|${url}|${geo}`) ?? null; },
    async compareAndSet(scopeId, url, geo, expectedVersion, nextLifecycle) {
      const key = `${scopeId}|${url}|${geo}`;
      if ((lifecycle.get(key)?.version ?? 0) !== expectedVersion) return null;
      const record = { version: expectedVersion + 1, lifecycle: nextLifecycle };
      lifecycle.set(key, record);
      return record;
    },
    async listObservations(scopeId) { return [...observations.values()].filter((item) => item.scopeId === scopeId); },
    async recordObservation(value) { observations.set(`${value.scopeId}|${value.target}|${value.geo}`, { ...value }); return value; }
  };
}

test('scheduled redirect loop requires two fresh trusted observations before BROKEN', async () => {
  const lifecycleStore = memoryStore();
  const env = { RADAR_PROBE_GEO: 'DE', VERCEL_REGION: 'FRA1' };
  const first = await runDomainLandingBatch({ targetStore, lifecycleStore, env, runCycle: redirectLoopCycle, now: () => new Date('2026-09-01T15:00:00Z') });
  assert.equal(first.results[0].state, 'NOT_OBSERVABLE');
  assert.equal(first.results[0].alertEvent, null);
  let persisted = (await lifecycleStore.listObservations('tenant-a'))[0];
  assert.equal(persisted.failureSignature, 'redirect:loop');
  assert.equal(persisted.failureConfirmations, 1);
  assert.equal(persisted.geoProvenance, 'TRUSTED_RUNTIME_VANTAGE');

  const second = await runDomainLandingBatch({ targetStore, lifecycleStore, env, runCycle: redirectLoopCycle, now: () => new Date('2026-09-01T15:05:00Z') });
  assert.equal(second.results[0].state, 'BROKEN');
  assert.equal(second.results[0].alertEvent, 'INCIDENT_OPEN');
  persisted = (await lifecycleStore.listObservations('tenant-a'))[0];
  assert.equal(persisted.failureConfirmations, 2);
  assert.equal(second.results[0].dependencyEdges, 0);
  assert.equal(second.roiProof.status, 'NOT_CLAIMED');
  assert.equal(second.roiProof.savedGgr, null);
});

test('stale or wrong-GEO redirect loop cannot corroborate', async () => {
  const first = await probeDomainLanding({ target: target.target, geo: 'DE' }, { lookupImpl, fetchImpl: async () => redirectResponse(), now: () => new Date('2026-09-01T15:00:00Z') });
  assert.equal(first.state, 'NOT_OBSERVABLE');
  assert.equal(first.failureSignature, 'redirect:loop');

  for (const previous of [
    { target: target.target, geo: 'DE', observedAt: first.observedAt, geoProvenance: 'TRUSTED_RUNTIME_VANTAGE', failureSignature: first.failureSignature, failureConfirmations: 1 },
    { target: target.target, geo: 'FR', observedAt: '2026-09-01T15:04:00Z', geoProvenance: 'TRUSTED_RUNTIME_VANTAGE', failureSignature: first.failureSignature, failureConfirmations: 1 }
  ]) {
    const now = previous.geo === 'DE' ? new Date('2026-09-01T16:00:00Z') : new Date('2026-09-01T15:05:00Z');
    const result = await probeDomainLanding({ target: target.target, geo: 'DE', redirectConfirmations: 99 }, { lookupImpl, fetchImpl: async () => redirectResponse(), now: () => now, trustedPreviousObservation: previous });
    assert.equal(result.state, 'NOT_OBSERVABLE');
    assert.equal(result.failureConfirmations, 1);
    assert.equal(result.evidence.observations.redirectConfirmations, 1);
  }
});
