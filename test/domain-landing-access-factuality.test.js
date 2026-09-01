import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyDomainLanding } from '../src/revenue-path.js';

const mirror = {
  target: 'https://mirror-b.example',
  geo: 'DE',
  state: 'HEALTHY',
  relation: 'same-group-mirror',
  provenance: 'Observed',
  geoProvenance: 'TRUSTED_RUNTIME_VANTAGE'
};

test('automated unknown 403 cannot become BROKEN solely from a healthy mirror', () => {
  const result = classifyDomainLanding({
    geo: 'DE',
    observations: {
      probeContext: 'automated',
      http: 403,
      page: 'unavailable'
    },
    controls: [mirror],
    evidenceClass: 'LIVE_OBSERVED'
  });

  assert.equal(result.state, 'NOT_OBSERVABLE');
  assert.equal(result.scope, 'access-probe-ambiguous');
  assert.equal(result.dependencyEdges, 0);
  assert.equal(result.cause, 'NOT_OBSERVABLE');
});

test('automated unknown 451 cannot become geo-local BROKEN from healthy GEO controls', () => {
  const result = classifyDomainLanding({
    geo: 'DE',
    observations: {
      probeContext: 'automated',
      http: 451,
      page: 'unavailable'
    },
    controls: [
      { target: 'https://operator.example', geo: 'US', state: 'HEALTHY' },
      { target: 'https://operator.example', geo: 'BR', state: 'HEALTHY' }
    ],
    evidenceClass: 'LIVE_OBSERVED'
  });

  assert.equal(result.state, 'NOT_OBSERVABLE');
  assert.equal(result.scope, 'access-probe-ambiguous');
  assert.equal(result.dependencyEdges, 0);
});

test('known automated challenge remains NOT_OBSERVABLE', () => {
  const result = classifyDomainLanding({
    geo: 'DE',
    observations: {
      probeContext: 'automated',
      http: 403,
      page: 'challenge'
    },
    controls: [mirror],
    evidenceClass: 'LIVE_OBSERVED'
  });

  assert.equal(result.state, 'NOT_OBSERVABLE');
  assert.equal(result.scope, 'probe-ambiguous');
  assert.equal(result.dependencyEdges, 0);
});

test('corroborated access failure may use a healthy mirror only to scope established failure', () => {
  const result = classifyDomainLanding({
    geo: 'DE',
    observations: {
      probeContext: 'automated',
      http: 403,
      page: 'unavailable',
      accessConfirmations: 2
    },
    controls: [mirror],
    evidenceClass: 'LIVE_OBSERVED'
  });

  assert.equal(result.state, 'BROKEN');
  assert.equal(result.scope, 'mirror-only-observed');
  assert.equal(result.dependencyEdges, 0);
  assert.equal(result.attributable, false);
  assert.equal(result.cause, 'NOT_OBSERVABLE');
});
