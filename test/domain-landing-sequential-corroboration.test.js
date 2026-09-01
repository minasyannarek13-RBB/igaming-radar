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
const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];

function response(status, body = '') {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get() { return null; } },
    async text() { return body; },
    async discard() {}
  };
}

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

function http503Cycle(input, options) {
  return runDomainLandingCycle(input, {
    ...options,
    probeImpl: (probeInput, probeOptions) => probeDomainLanding(probeInput, {
      ...probeOptions,
      lookupImpl: publicLookup,
      fetchImpl: async () => response(503, '<html><body>Service unavailable</body></html>')
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

test('two fresh independent scheduled 503 observations open BROKEN only on the second trusted sample', async () => {
  const lifecycleStore = createMemoryLifecycleStore();
  const times = [new Date('2026-09-01T13:00:00Z'), new Date('2026-09-01T13:05:00Z')];

  const first = await runDomainLandingBatch({ targetStore, lifecycleStore, env: { RADAR_PROBE_GEO: 'DE', VERCEL_REGION: 'FRA1' }, runCycle: http503Cycle, now: () => times[0] });
  assert.equal(first.results[0].state, 'NOT_OBSERVABLE');
  assert.equal(first.results[0].alertEvent, null);
  let persisted = (await lifecycleStore.listObservations('tenant-a'))[0];
  assert.equal(persisted.failureSignature, 'http:503');
  assert.equal(persisted.failureConfirmations, 1);
  assert.equal(persisted.geoProvenance, 'TRUSTED_RUNTIME_VANTAGE');

  const second = await runDomainLandingBatch({ targetStore, lifecycleStore, env: { RADAR_PROBE_GEO: 'DE', VERCEL_REGION: 'FRA1' }, runCycle: http503Cycle, now: () => times[1] });
  assert.equal(second.results[0].state, 'BROKEN');
  assert.equal(second.results[0].alertEvent, 'INCIDENT_OPEN');
  persisted = (await lifecycleStore.listObservations('tenant-a'))[0];
  assert.equal(persisted.failureSignature, 'http:503');
  assert.equal(persisted.failureConfirmations, 2);
  assert.equal(second.roiProof.status, 'NOT_CLAIMED');
  assert.equal(second.roiProof.savedGgr, null);
});

test('5xx status signature mismatch resets sequential corroboration', async () => {
  const first = await probeDomainLanding({ target: target.target, geo: 'DE' }, {
    lookupImpl: publicLookup,
    fetchImpl: async () => response(503),
    now: () => new Date('2026-09-01T13:00:00Z')
  });
  const second = await probeDomainLanding({ target: target.target, geo: 'DE' }, {
    lookupImpl: publicLookup,
    fetchImpl: async () => response(500),
    now: () => new Date('2026-09-01T13:05:00Z'),
    trustedPreviousObservation: { target: target.target, geo: 'DE', state: first.state, observedAt: first.observedAt, geoProvenance: 'TRUSTED_RUNTIME_VANTAGE', failureSignature: first.failureSignature, failureConfirmations: first.failureConfirmations }
  });
  assert.equal(second.state, 'NOT_OBSERVABLE');
  assert.equal(second.failureSignature, 'http:500');
  assert.equal(second.failureConfirmations, 1);
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
  const result = await probeDomainLanding({ target: target.target, geo: 'DE', dnsConfirmations: 99, http5xxConfirmations: 99, observations: { dnsConfirmations: 99, http5xxConfirmations: 99 } }, {
    lookupImpl: async () => [], fetchImpl: async () => { throw new Error('unused'); }, now: () => new Date('2026-09-01T12:00:00Z')
  });
  assert.equal(result.state, 'NOT_OBSERVABLE');
  assert.equal(result.failureConfirmations, 1);
  assert.equal(result.evidence.observations.dnsConfirmations, 1);
});
