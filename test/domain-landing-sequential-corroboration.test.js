import test from 'node:test';
import assert from 'node:assert/strict';
import { runDomainLandingBatch } from '../src/domain-landing-scheduler.js';
import { runDomainLandingCycle } from '../src/domain-landing-cycle.js';
import { probeDomainLanding } from '../src/domain-landing-probe.js';

function createMemoryLifecycleStore() {
  const lifecycle = new Map();
  const observations = new Map();
  return {
    persistence: 'TEST_DURABLE_STORE',
    async get(scopeId, target, geo) { return lifecycle.get(`${scopeId}|${target}|${geo}`) ?? null; },
    async compareAndSet(scopeId, target, geo, expectedVersion, nextLifecycle) {
      const key = `${scopeId}|${target}|${geo}`;
      const current = lifecycle.get(key);
      if ((current?.version ?? 0) !== expectedVersion) return null;
      const record = { version: expectedVersion + 1, lifecycle: nextLifecycle };
      lifecycle.set(key, record);
      return record;
    },
    async listObservations(scopeId) { return [...observations.values()].filter((item) => item.scopeId === scopeId); },
    async recordObservation(value) { observations.set(`${value.scopeId}|${value.target}|${value.geo}`, { ...value }); return value; }
  };
}

const target = { id: 'target-a', scopeId: 'tenant-a', target: 'https://operator.example/', requestedGeo: 'DE', enabled: true, recoveryConfirmations: 2, config: {} };
const targetStore = { async list() { return [target]; }, async markRun() {} };

function dnsFailureCycle(input, options) {
  return runDomainLandingCycle(input, {
    ...options,
    probeImpl: (probeInput, probeOptions) => probeDomainLanding(probeInput, {
      ...probeOptions,
      lookupImpl: async () => [],
      fetchImpl: async () => { throw new Error('fetch must not execute after DNS failure'); }
    })
  });
}

test('two fresh independent scheduled DNS observations promote ambiguity to BROKEN without weakening thresholds', async () => {
  const lifecycleStore = createMemoryLifecycleStore();
  const times = [new Date('2026-09-01T12:00:00Z'), new Date('2026-09-01T12:05:00Z')];

  const first = await runDomainLandingBatch({ targetStore, lifecycleStore, env: { RADAR_PROBE_GEO: 'DE', VERCEL_REGION: 'FRA1' }, runCycle: dnsFailureCycle, now: () => times[0] });
  assert.equal(first.results[0].state, 'NOT_OBSERVABLE');
  let persisted = (await lifecycleStore.listObservations('tenant-a'))[0];
  assert.equal(persisted.failureSignature, 'dns:fail');
  assert.equal(persisted.failureConfirmations, 1);
  assert.equal(persisted.geoProvenance, 'TRUSTED_RUNTIME_VANTAGE');

  const second = await runDomainLandingBatch({ targetStore, lifecycleStore, env: { RADAR_PROBE_GEO: 'DE', VERCEL_REGION: 'FRA1' }, runCycle: dnsFailureCycle, now: () => times[1] });
  assert.equal(second.results[0].state, 'BROKEN');
  assert.equal(second.results[0].alertEvent, 'INCIDENT_OPEN');
  persisted = (await lifecycleStore.listObservations('tenant-a'))[0];
  assert.equal(persisted.failureSignature, 'dns:fail');
  assert.equal(persisted.failureConfirmations, 2);
  assert.equal(second.roiProof.status, 'NOT_CLAIMED');
  assert.equal(second.roiProof.savedGgr, null);
});

test('stale trusted failure does not corroborate a new automated failure', async () => {
  const first = await probeDomainLanding({ target: target.target, geo: 'DE' }, {
    lookupImpl: async () => [], fetchImpl: async () => { throw new Error('unused'); }, now: () => new Date('2026-09-01T11:00:00Z')
  });
  const second = await probeDomainLanding({ target: target.target, geo: 'DE' }, {
    lookupImpl: async () => [], fetchImpl: async () => { throw new Error('unused'); }, now: () => new Date('2026-09-01T12:00:00Z'),
    trustedPreviousObservation: { scopeId: 'tenant-a', target: target.target, geo: 'DE', state: first.state, observedAt: first.observedAt, geoProvenance: 'TRUSTED_RUNTIME_VANTAGE', failureSignature: first.failureSignature, failureConfirmations: first.failureConfirmations }
  });
  assert.equal(second.state, 'NOT_OBSERVABLE');
  assert.equal(second.failureConfirmations, 1);
});

test('caller data cannot manufacture sequential confirmations', async () => {
  const result = await probeDomainLanding({ target: target.target, geo: 'DE', dnsConfirmations: 99, observations: { dnsConfirmations: 99 } }, {
    lookupImpl: async () => [], fetchImpl: async () => { throw new Error('unused'); }, now: () => new Date('2026-09-01T12:00:00Z')
  });
  assert.equal(result.state, 'NOT_OBSERVABLE');
  assert.equal(result.failureConfirmations, 1);
  assert.equal(result.evidence.observations.dnsConfirmations, 1);
});
