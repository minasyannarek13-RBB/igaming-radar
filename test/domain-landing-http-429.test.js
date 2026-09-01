import test from 'node:test';
import assert from 'node:assert/strict';
import { probeDomainLanding } from '../src/domain-landing-probe.js';
import { classifyDomainLanding } from '../src/revenue-path.js';

const NOW = new Date('2026-09-01T20:30:00.000Z');
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

test('automated HTTP 429 is NOT_OBSERVABLE and cannot become false HEALTHY', async () => {
  const result = await probeDomainLanding({
    target: 'https://operator.example/landing',
    geo: 'DE'
  }, {
    lookupImpl: publicLookup,
    fetchImpl: async () => response(429, '<html><body>Too Many Requests</body></html>'),
    now: () => NOW
  });

  assert.equal(result.state, 'NOT_OBSERVABLE');
  assert.equal(result.scope, 'probe-rate-limited');
  assert.equal(result.evidence.observations.http, 429);
  assert.equal(result.cause, 'NOT_OBSERVABLE');
  assert.equal(result.attribution, 'Not observable externally');
  assert.equal(result.dependencyEdges, 0);
  assert.equal(result.failureSignature, null);
  assert.equal(result.failureConfirmations, 0);
  assert.deepEqual(result.roiProof, { status: 'NOT_CLAIMED', savedGgr: null, savedRevenue: null });
});

test('429 guard does not reinterpret the observation as operator downtime', () => {
  const result = classifyDomainLanding({
    geo: 'DE',
    observations: { probeContext: 'automated', dns: 'ok', tls: 'ok', http: 429, page: 'content' },
    controls: [],
    evidenceClass: 'LIVE_OBSERVED'
  });

  assert.equal(result.state, 'NOT_OBSERVABLE');
  assert.equal(result.scope, 'probe-rate-limited');
  assert.equal(result.cause, 'NOT_OBSERVABLE');
  assert.equal(result.attributable, false);
  assert.equal(result.dependencyEdges, 0);
});
