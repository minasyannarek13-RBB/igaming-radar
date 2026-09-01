import test from 'node:test';
import assert from 'node:assert/strict';
import { probeDomainLanding } from '../src/domain-landing-probe.js';

const BASE = new Date('2026-09-01T20:00:00.000Z');
const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];
function response(status, body = '<html>missing</html>') { return { status, ok: status >= 200 && status < 300, headers: { get() { return null; } }, async text() { return body; }, async discard() {} }; }
function trustedPrevious({ status = 404, ageMs = 60_000, confirmations = 1 } = {}) {
  return {
    target: 'https://operator.example/landing', geo: 'DE', geoProvenance: 'TRUSTED_RUNTIME_VANTAGE',
    observedAt: new Date(BASE.getTime() - ageMs).toISOString(), failureSignature: `http:${status}`, failureConfirmations: confirmations
  };
}
async function probe(status, options = {}) {
  return probeDomainLanding({ target: 'https://operator.example/landing', geo: 'DE' }, {
    lookupImpl: publicLookup, fetchImpl: async () => response(status), now: () => BASE,
    trustedPreviousObservation: options.previous ?? null
  });
}

test('first automated 404 fails closed as NOT_OBSERVABLE', async () => {
  const result = await probe(404);
  assert.equal(result.state, 'NOT_OBSERVABLE');
  assert.equal(result.scope, 'http-missing-probe-ambiguous');
  assert.equal(result.failureSignature, 'http:404');
  assert.equal(result.failureConfirmations, 1);
  assert.equal(result.evidence.observations.httpMissingConfirmations, 1);
  assert.equal(result.dependencyEdges, 0);
  assert.equal(result.attribution, 'Not observable externally');
  assert.deepEqual(result.roiProof, { status: 'NOT_CLAIMED', savedGgr: null, savedRevenue: null });
});

test('second fresh trusted same-status 404 can become BROKEN without attribution', async () => {
  const result = await probe(404, { previous: trustedPrevious() });
  assert.equal(result.state, 'BROKEN');
  assert.equal(result.scope, 'target-corroborated');
  assert.equal(result.failureSignature, 'http:404');
  assert.equal(result.failureConfirmations, 2);
  assert.equal(result.evidence.observations.httpMissingConfirmations, 2);
  assert.equal(result.dependencyEdges, 0);
  assert.equal(result.attribution, 'Not observable externally');
});

test('404 then 410 does not corroborate because status is bound into signature', async () => {
  const result = await probe(410, { previous: trustedPrevious({ status: 404 }) });
  assert.equal(result.state, 'NOT_OBSERVABLE');
  assert.equal(result.failureSignature, 'http:410');
  assert.equal(result.failureConfirmations, 1);
});

test('stale trusted 404 does not corroborate', async () => {
  const result = await probe(404, { previous: trustedPrevious({ ageMs: 16 * 60 * 1000 }) });
  assert.equal(result.state, 'NOT_OBSERVABLE');
  assert.equal(result.failureConfirmations, 1);
});

test('first automated 410 is NOT_OBSERVABLE with stable 410 signature', async () => {
  const result = await probe(410);
  assert.equal(result.state, 'NOT_OBSERVABLE');
  assert.equal(result.failureSignature, 'http:410');
  assert.equal(result.failureConfirmations, 1);
  assert.equal(result.dependencyEdges, 0);
});
