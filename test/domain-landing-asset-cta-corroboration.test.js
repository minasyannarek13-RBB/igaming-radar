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

function configuredTarget(config) {
  return { id: 'target-a', scopeId: 'tenant-a', target: 'https://operator.example/', requestedGeo: 'DE', enabled: true, recoveryConfirmations: 2, config };
}
function storeFor(target) { return { async list() { return [target]; }, async markRun() {} }; }
function cycleWith(fetchImpl) {
  return (input, options) => runDomainLandingCycle(input, {
    ...options,
    probeImpl: (probeInput, probeOptions) => probeDomainLanding(probeInput, { ...probeOptions, lookupImpl: publicLookup, fetchImpl })
  });
}

const env = { RADAR_PROBE_GEO: 'DE', VERCEL_REGION: 'FRA1' };

test('first critical asset 503 is ambiguous; second fresh matching trusted observation may open DEGRADED', async () => {
  const target = configuredTarget({ criticalAssetUrls: ['https://cdn.example/app.js'] });
  const targetStore = storeFor(target);
  const lifecycleStore = createMemoryLifecycleStore();
  const fetchImpl = async (url) => url.hostname === 'cdn.example' ? response(503) : response(200, '<html><body>ok</body></html>');
  const runCycle = cycleWith(fetchImpl);

  const first = await runDomainLandingBatch({ targetStore, lifecycleStore, env, runCycle, now: () => new Date('2026-09-01T14:00:00Z') });
  assert.equal(first.results[0].state, 'NOT_OBSERVABLE');
  assert.equal(first.results[0].alertEvent, null);
  let persisted = (await lifecycleStore.listObservations('tenant-a'))[0];
  assert.equal(persisted.failureSignature, 'asset:https://cdn.example/app.js:503');
  assert.equal(persisted.failureConfirmations, 1);

  const second = await runDomainLandingBatch({ targetStore, lifecycleStore, env, runCycle, now: () => new Date('2026-09-01T14:05:00Z') });
  assert.equal(second.results[0].state, 'DEGRADED');
  assert.equal(second.results[0].alertEvent, 'INCIDENT_OPEN');
  persisted = (await lifecycleStore.listObservations('tenant-a'))[0];
  assert.equal(persisted.failureConfirmations, 2);
  assert.equal(second.roiProof.status, 'NOT_CLAIMED');
  assert.equal(second.roiProof.savedGgr, null);
});

test('critical asset status/signature mismatch resets corroboration', async () => {
  const config = { criticalAssetUrls: ['https://cdn.example/app.js'] };
  const first = await probeDomainLanding({ target: 'https://operator.example/', geo: 'DE', config }, {
    lookupImpl: publicLookup,
    fetchImpl: async (url) => url.hostname === 'cdn.example' ? response(503) : response(200, '<html>ok</html>'),
    now: () => new Date('2026-09-01T14:00:00Z')
  });
  const second = await probeDomainLanding({ target: 'https://operator.example/', geo: 'DE', config }, {
    lookupImpl: publicLookup,
    fetchImpl: async (url) => url.hostname === 'cdn.example' ? response(500) : response(200, '<html>ok</html>'),
    now: () => new Date('2026-09-01T14:05:00Z'),
    trustedPreviousObservation: { target: first.target, geo: 'DE', observedAt: first.observedAt, geoProvenance: 'TRUSTED_RUNTIME_VANTAGE', failureSignature: first.failureSignature, failureConfirmations: first.failureConfirmations }
  });
  assert.equal(second.state, 'NOT_OBSERVABLE');
  assert.equal(second.failureConfirmations, 1);
  assert.equal(second.failureSignature, 'asset:https://cdn.example/app.js:500');
});

test('first critical CTA marker miss is ambiguous; second fresh matching trusted observation may open DEGRADED', async () => {
  const target = configuredTarget({ ctaCritical: true, ctaMarkers: ['Deposit now'] });
  const targetStore = storeFor(target);
  const lifecycleStore = createMemoryLifecycleStore();
  const runCycle = cycleWith(async () => response(200, '<html><body>Lobby</body></html>'));

  const first = await runDomainLandingBatch({ targetStore, lifecycleStore, env, runCycle, now: () => new Date('2026-09-01T15:00:00Z') });
  assert.equal(first.results[0].state, 'NOT_OBSERVABLE');
  assert.equal(first.results[0].alertEvent, null);
  let persisted = (await lifecycleStore.listObservations('tenant-a'))[0];
  assert.equal(persisted.failureSignature, 'cta:missing:deposit now');
  assert.equal(persisted.failureConfirmations, 1);

  const second = await runDomainLandingBatch({ targetStore, lifecycleStore, env, runCycle, now: () => new Date('2026-09-01T15:05:00Z') });
  assert.equal(second.results[0].state, 'DEGRADED');
  assert.equal(second.results[0].alertEvent, 'INCIDENT_OPEN');
  persisted = (await lifecycleStore.listObservations('tenant-a'))[0];
  assert.equal(persisted.failureConfirmations, 2);
});

test('CTA marker configuration mismatch and forged caller confirmations do not corroborate', async () => {
  const firstConfig = { ctaCritical: true, ctaMarkers: ['Deposit now'] };
  const first = await probeDomainLanding({ target: 'https://operator.example/', geo: 'DE', config: firstConfig }, {
    lookupImpl: publicLookup,
    fetchImpl: async () => response(200, '<html>Lobby</html>'),
    now: () => new Date('2026-09-01T15:00:00Z')
  });
  const second = await probeDomainLanding({ target: 'https://operator.example/', geo: 'DE', ctaConfirmations: 99, config: { ctaCritical: true, ctaMarkers: ['Play now'] } }, {
    lookupImpl: publicLookup,
    fetchImpl: async () => response(200, '<html>Lobby</html>'),
    now: () => new Date('2026-09-01T15:05:00Z'),
    trustedPreviousObservation: { target: first.target, geo: 'DE', observedAt: first.observedAt, geoProvenance: 'TRUSTED_RUNTIME_VANTAGE', failureSignature: first.failureSignature, failureConfirmations: first.failureConfirmations }
  });
  assert.equal(second.state, 'NOT_OBSERVABLE');
  assert.equal(second.failureConfirmations, 1);
  assert.equal(second.failureSignature, 'cta:missing:play now');
  assert.equal(second.evidence.observations.ctaConfirmations, 1);
});

test('stale critical asset failure does not corroborate', async () => {
  const config = { criticalAssetUrls: ['https://cdn.example/app.js'] };
  const first = await probeDomainLanding({ target: 'https://operator.example/', geo: 'DE', config }, {
    lookupImpl: publicLookup,
    fetchImpl: async (url) => url.hostname === 'cdn.example' ? response(503) : response(200),
    now: () => new Date('2026-09-01T14:00:00Z')
  });
  const second = await probeDomainLanding({ target: 'https://operator.example/', geo: 'DE', config }, {
    lookupImpl: publicLookup,
    fetchImpl: async (url) => url.hostname === 'cdn.example' ? response(503) : response(200),
    now: () => new Date('2026-09-01T15:00:00Z'),
    trustedPreviousObservation: { target: first.target, geo: 'DE', observedAt: first.observedAt, geoProvenance: 'TRUSTED_RUNTIME_VANTAGE', failureSignature: first.failureSignature, failureConfirmations: first.failureConfirmations }
  });
  assert.equal(second.state, 'NOT_OBSERVABLE');
  assert.equal(second.failureConfirmations, 1);
});
