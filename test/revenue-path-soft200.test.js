import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyDomainLanding } from '../src/revenue-path.js';

test('single automated soft-200 error-template with healthy controls is NOT_OBSERVABLE and preserves evidence', () => {
  const observations = {
    dns: 'ok',
    tls: 'ok',
    http: 200,
    page: 'error-template',
    probeContext: 'automated'
  };
  const controls = [
    { geo: 'NL', state: 'HEALTHY' },
    { geo: 'GB', state: 'HEALTHY' }
  ];

  const result = classifyDomainLanding({
    geo: 'DE',
    evidenceClass: 'LIVE_OBSERVED',
    observations,
    controls
  });

  assert.equal(result.state, 'NOT_OBSERVABLE');
  assert.equal(result.scope, 'soft-200-probe-ambiguous');
  assert.equal(result.attributable, false);
  assert.equal(result.cause, 'NOT_OBSERVABLE');
  assert.equal(result.dependencyEdges, 0);
  assert.deepEqual(result.evidence.observations, observations);
  assert.deepEqual(result.evidence.controls, controls);
  assert.equal(result.evidence.geo, 'DE');
  assert.equal(result.evidence.evidenceClass, 'LIVE_OBSERVED');
});

test('corroborated repeated automated soft-200 may be BROKEN without invented cause', () => {
  const result = classifyDomainLanding({
    geo: 'DE',
    evidenceClass: 'LIVE_OBSERVED',
    observations: {
      dns: 'ok',
      tls: 'ok',
      http: 200,
      page: 'error-template',
      probeContext: 'automated',
      pageConfirmations: 2
    }
  });

  assert.equal(result.state, 'BROKEN');
  assert.equal(result.scope, 'landing-corroborated');
  assert.equal(result.attributable, false);
  assert.equal(result.cause, 'NOT_OBSERVABLE');
  assert.equal(result.dependencyEdges, 0);
});

test('multi-vantage soft-200 may be BROKEN without claiming WAF/operator/platform cause', () => {
  const result = classifyDomainLanding({
    geo: 'MULTI',
    evidenceClass: 'LIVE_OBSERVED',
    observations: {
      dns: 'ok',
      tls: 'ok',
      http: 200,
      page: 'error-template',
      probeContext: 'automated'
    }
  });

  assert.equal(result.state, 'BROKEN');
  assert.equal(result.scope, 'landing-global-observed');
  assert.equal(result.attributable, false);
  assert.equal(result.cause, 'NOT_OBSERVABLE');
  assert.equal(result.dependencyEdges, 0);
});
