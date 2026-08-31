import test from 'node:test';
import assert from 'node:assert/strict';
import { runDomainLandingCycle } from '../src/domain-landing-cycle.js';

class MemoryStore {
  constructor() {
    this.records = new Map();
    this.persistence = 'TEST_MEMORY';
  }

  key(scopeId, target, geo) {
    return `${scopeId}|${target}|${geo}`;
  }

  async get(scopeId, target, geo) {
    return this.records.get(this.key(scopeId, target, geo)) ?? null;
  }

  async compareAndSet(scopeId, target, geo, expectedVersion, lifecycle) {
    const key = this.key(scopeId, target, geo);
    const current = this.records.get(key);
    if ((current?.version ?? 0) !== expectedVersion) return null;
    const record = { version: expectedVersion + 1, lifecycle };
    this.records.set(key, record);
    return record;
  }
}

function probeSequence(states) {
  let index = 0;
  return async (input, { now }) => {
    const state = states[Math.min(index++, states.length - 1)];
    return {
      target: input.target,
      observedAt: now().toISOString(),
      state,
      scope: state === 'HEALTHY' ? 'none' : state === 'NOT_OBSERVABLE' ? 'probe-ambiguous' : 'conversion-path',
      cause: 'NOT_OBSERVABLE',
      dependencyEdges: 0,
      evidence: { geo: input.geo, evidenceClass: 'SYNTHETIC_TEST', observations: {}, controls: [] },
      roiProof: { status: 'NOT_CLAIMED', savedGgr: null, savedRevenue: null }
    };
  };
}

test('persists incident, requires healthy hysteresis, and reports final exposure duration', async () => {
  const store = new MemoryStore();
  const times = [
    new Date('2026-09-01T00:00:00Z'),
    new Date('2026-09-01T00:05:00Z'),
    new Date('2026-09-01T00:10:00Z')
  ];
  let i = 0;
  const now = () => times[i++];
  const probeImpl = probeSequence(['BROKEN', 'HEALTHY', 'HEALTHY']);
  const input = { scopeId: 'tenant-a', target: 'https://example.com/', geo: 'AM' };

  const opened = await runDomainLandingCycle(input, { store, probeImpl, now });
  assert.equal(opened.lifecycle.incidentOpen, true);
  assert.equal(opened.alert.event, 'INCIDENT_OPEN');
  assert.equal(opened.alert.roiProof.savedGgr, null);

  const candidate = await runDomainLandingCycle(input, { store, probeImpl, now });
  assert.equal(candidate.lifecycle.incidentOpen, true);
  assert.equal(candidate.alert, null);

  const recovered = await runDomainLandingCycle(input, { store, probeImpl, now });
  assert.equal(recovered.lifecycle.incidentOpen, false);
  assert.equal(recovered.lifecycle.state, 'HEALTHY');
  assert.equal(recovered.lifecycle.exposureDurationMs, 600000);
  assert.equal(recovered.alert.event, 'RECOVERY');
  assert.equal(recovered.alert.attribution.dependencyEdges, 0);
});

test('NOT_OBSERVABLE cannot prove recovery', async () => {
  const store = new MemoryStore();
  const times = [new Date('2026-09-01T01:00:00Z'), new Date('2026-09-01T01:05:00Z')];
  let i = 0;
  const now = () => times[i++];
  const probeImpl = probeSequence(['DEGRADED', 'NOT_OBSERVABLE']);
  const input = { scopeId: 'tenant-a', target: 'https://example.com/', geo: 'AM' };

  await runDomainLandingCycle(input, { store, probeImpl, now });
  const ambiguous = await runDomainLandingCycle(input, { store, probeImpl, now });
  assert.equal(ambiguous.lifecycle.incidentOpen, true);
  assert.equal(ambiguous.lifecycle.state, 'DEGRADED');
  assert.equal(ambiguous.lifecycle.recoveredAt, null);
  assert.equal(ambiguous.alert, null);
});

test('CAS conflict retries without losing the observation', async () => {
  const store = new MemoryStore();
  let first = true;
  const baseCas = store.compareAndSet.bind(store);
  store.compareAndSet = async (...args) => {
    if (first) {
      first = false;
      return null;
    }
    return baseCas(...args);
  };

  const result = await runDomainLandingCycle(
    { scopeId: 'tenant-b', target: 'https://example.org/', geo: 'US' },
    {
      store,
      probeImpl: probeSequence(['BROKEN']),
      now: () => new Date('2026-09-01T02:00:00Z')
    }
  );

  assert.equal(result.lifecycle.incidentOpen, true);
  assert.equal(result.alert.event, 'INCIDENT_OPEN');
});
