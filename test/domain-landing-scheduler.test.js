import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDomainLandingTarget } from '../src/domain-landing-target-store.js';
import { runDomainLandingBatch } from '../src/domain-landing-scheduler.js';

test('normalizes durable target config without treating requested GEO as observed GEO', () => {
  const record = normalizeDomainLandingTarget({
    scopeId: 'tenant-a',
    target: 'https://example.com/path#fragment',
    requestedGeo: 'de',
    recoveryConfirmations: 3
  }, { now: () => new Date('2026-09-01T03:00:00Z') });

  assert.equal(record.scopeId, 'tenant-a');
  assert.equal(record.target, 'https://example.com/path');
  assert.equal(record.requestedGeo, 'DE');
  assert.equal(record.recoveryConfirmations, 3);
  assert.equal(record.enabled, true);
  assert.equal(record.lastRunAt, null);
  assert.match(record.id, /^[a-f0-9]{64}$/);
});

test('rejects non-http target configuration', () => {
  assert.throws(() => normalizeDomainLandingTarget({
    scopeId: 'tenant-a',
    target: 'file:///etc/passwd'
  }), /INVALID_TARGET_SCHEME/);
});

test('batch runs enabled targets through trusted vantage and records success/failure independently', async () => {
  const targets = [
    { id: 'a', scopeId: 'tenant-a', target: 'https://a.example/', requestedGeo: 'DE', enabled: true, recoveryConfirmations: 2 },
    { id: 'b', scopeId: 'tenant-a', target: 'https://b.example/', requestedGeo: 'US', enabled: true, recoveryConfirmations: 2 }
  ];
  const marks = [];
  const targetStore = {
    async list() { return targets; },
    async markRun(id, value) { marks.push({ id, ...value }); }
  };
  const lifecycleStore = {
    async get() { return null; },
    async compareAndSet() { return { version: 1, lifecycle: {} }; }
  };
  const bound = [];
  const bindVantage = (input) => {
    bound.push(input);
    return {
      requestedGeo: input.requestedGeo,
      geoProvenance: 'TRUSTED_RUNTIME_VANTAGE',
      payload: { ...input, geo: 'AM' }
    };
  };
  const runCycle = async (input) => {
    if (input.target.includes('b.example')) throw new Error('synthetic_failure');
    return {
      geo: input.geo,
      lifecycle: { state: 'HEALTHY' },
      alert: null,
      probe: { state: 'HEALTHY' }
    };
  };

  const result = await runDomainLandingBatch({
    targetStore,
    lifecycleStore,
    bindVantage,
    runCycle,
    now: () => new Date('2026-09-01T03:05:00Z')
  });

  assert.equal(result.attempted, 2);
  assert.equal(result.succeeded, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.results[0].requestedGeo, 'DE');
  assert.equal(result.results[0].observedGeo, 'AM');
  assert.equal(result.results[1].state, 'NOT_OBSERVABLE');
  assert.deepEqual(marks.map((x) => [x.id, x.status]), [['a', 'SUCCESS'], ['b', 'FAILED']]);
  assert.equal(bound[0].requestedGeo, 'DE');
  assert.equal(result.roiProof.savedGgr, null);
});
