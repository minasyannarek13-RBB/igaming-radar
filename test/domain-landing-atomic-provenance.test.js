import test from 'node:test';
import assert from 'node:assert/strict';
import { RedisRestRevenuePathStore } from '../src/revenue-path-lifecycle-store.js';
import { runDomainLandingCycle } from '../src/domain-landing-cycle.js';

test('redis store commits lifecycle, latest observation and immutable history in one EVAL transaction', async () => {
  const commands = [];
  const fetchImpl = async (_url, options) => {
    commands.push(JSON.parse(options.body));
    return { ok: true, async json() { return { result: 'STORED' }; } };
  };
  const store = new RedisRestRevenuePathStore({ url: 'https://redis.example', token: 'test-token', fetchImpl });
  const lifecycle = { state: 'BROKEN', incident: { openedAt: '2026-09-01T16:00:00.000Z' } };
  const observation = { scopeId: 'tenant-a', target: 'https://example.com/', geo: 'DE', state: 'BROKEN', observedAt: '2026-09-01T16:00:00.000Z', geoProvenance: 'TRUSTED_RUNTIME_VANTAGE', failureSignature: 'http:503', failureConfirmations: 2 };
  const stored = await store.compareAndSetWithObservation('tenant-a', 'https://example.com/', 'DE', 0, lifecycle, observation);

  assert.equal(commands.length, 1);
  assert.equal(commands[0][0], 'EVAL');
  assert.equal(commands[0][2], '3');
  assert.match(commands[0][1], /redis\.call\('SET'/);
  assert.match(commands[0][1], /redis\.call\('HSET'/);
  assert.match(commands[0][1], /redis\.call\('ZADD'/);
  assert.match(commands[0][1], /redis\.call\('ZREMRANGEBYRANK'/);
  assert.equal(stored.version, 1);
  assert.equal(stored.observation.failureSignature, 'http:503');
  assert.equal(stored.observation.failureConfirmations, 2);
});

test('atomic store rejects observation key mismatch before any write', async () => {
  let calls = 0;
  const store = new RedisRestRevenuePathStore({ url: 'https://redis.example', token: 'test-token', fetchImpl: async () => { calls += 1; return { ok: true, async json() { return { result: 'STORED' }; } }; } });
  await assert.rejects(() => store.compareAndSetWithObservation('tenant-a', 'https://example.com/', 'DE', 0, { state: 'HEALTHY' }, { scopeId: 'tenant-b', target: 'https://example.com/', geo: 'DE', state: 'HEALTHY', observedAt: '2026-09-01T16:00:00.000Z', geoProvenance: 'TRUSTED_RUNTIME_VANTAGE' }), /OBSERVATION_KEY_MISMATCH/);
  assert.equal(calls, 0);
});

test('listObservations returns retained provenance history newest-first instead of one overwritten target/geo value', async () => {
  const older = { scopeId: 'tenant-a', target: 'https://example.com/', geo: 'DE', state: 'NOT_OBSERVABLE', observedAt: '2026-09-01T16:00:00.000Z', geoProvenance: 'TRUSTED_RUNTIME_VANTAGE', controlGroup: null, failureSignature: 'http:503', failureConfirmations: 1 };
  const newer = { ...older, state: 'BROKEN', observedAt: '2026-09-01T16:01:00.000Z', failureConfirmations: 2 };
  const member = (record) => `${record.observedAt}:hash:${JSON.stringify(record)}`;
  const commands = [];
  const store = new RedisRestRevenuePathStore({
    url: 'https://redis.example',
    token: 'test-token',
    fetchImpl: async (_url, options) => {
      const command = JSON.parse(options.body);
      commands.push(command);
      return { ok: true, async json() { return { result: command[0] === 'ZREVRANGE' ? [member(newer), member(older)] : [] }; } };
    }
  });

  const observations = await store.listObservations('tenant-a');
  assert.equal(commands.length, 1);
  assert.equal(commands[0][0], 'ZREVRANGE');
  assert.equal(observations.length, 2);
  assert.equal(observations[0].state, 'BROKEN');
  assert.equal(observations[0].failureConfirmations, 2);
  assert.equal(observations[1].state, 'NOT_OBSERVABLE');
  assert.equal(observations[1].failureConfirmations, 1);
});

test('listObservations falls back to legacy latest-observation hash when history is empty', async () => {
  const legacy = { scopeId: 'tenant-a', target: 'https://example.com/', geo: 'DE', state: 'HEALTHY', observedAt: '2026-09-01T15:00:00.000Z', geoProvenance: 'TRUSTED_RUNTIME_VANTAGE' };
  const commands = [];
  const store = new RedisRestRevenuePathStore({
    url: 'https://redis.example',
    token: 'test-token',
    fetchImpl: async (_url, options) => {
      const command = JSON.parse(options.body);
      commands.push(command);
      const result = command[0] === 'ZREVRANGE' ? [] : ['field', JSON.stringify(legacy)];
      return { ok: true, async json() { return { result }; } };
    }
  });

  const observations = await store.listObservations('tenant-a');
  assert.deepEqual(commands.map((command) => command[0]), ['ZREVRANGE', 'HGETALL']);
  assert.equal(observations.length, 1);
  assert.equal(observations[0].state, 'HEALTHY');
});

test('Domain Landing cycle uses atomic provenance path and never performs split CAS', async () => {
  let atomicCalls = 0;
  let splitCalls = 0;
  let writtenObservation;
  const store = {
    persistence: 'DURABLE_TEST',
    async get() { return null; },
    async compareAndSet() { splitCalls += 1; throw new Error('split_write_must_not_run'); },
    async compareAndSetWithObservation(_scopeId, _target, _geo, expectedVersion, lifecycle, observation) {
      atomicCalls += 1;
      writtenObservation = observation;
      return { version: expectedVersion + 1, lifecycle, observation };
    }
  };
  const probeImpl = async () => ({
    target: 'https://example.com/',
    state: 'HEALTHY',
    scope: 'target-observed',
    cause: 'NONE',
    observedAt: '2026-09-01T16:00:00.000Z',
    evidence: { geo: 'DE', evidenceClass: 'SYNTHETIC_TEST', observations: {}, controls: [] }
  });
  const result = await runDomainLandingCycle({ scopeId: 'tenant-a', target: 'https://example.com/', geo: 'DE' }, {
    store,
    probeImpl,
    now: () => new Date('2026-09-01T16:00:00.000Z'),
    observationContext: { geoProvenance: 'TRUSTED_RUNTIME_VANTAGE', controlGroup: 'operator-main' }
  });

  assert.equal(atomicCalls, 1);
  assert.equal(splitCalls, 0);
  assert.equal(result.observationPersistedAtomically, true);
  assert.equal(writtenObservation.scopeId, 'tenant-a');
  assert.equal(writtenObservation.geoProvenance, 'TRUSTED_RUNTIME_VANTAGE');
  assert.equal(writtenObservation.controlGroup, 'operator-main');
  assert.equal(result.roiProof.savedGgr, null);
});
