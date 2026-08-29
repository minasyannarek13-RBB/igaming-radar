import test from 'node:test';
import assert from 'node:assert/strict';

import {
  OBSERVATION_STATES,
  validateDependencyEdge,
  validateEvidence
} from '../src/evidence.js';

function evidence(overrides = {}) {
  return {
    sourceId: 'source-a',
    observedAt: '2026-08-30T00:00:00Z',
    locator: 'https://example.com/resource.js',
    evidenceClass: 'network-resource',
    state: OBSERVATION_STATES.OBSERVED,
    ...overrides
  };
}

test('accepts a complete observed evidence record', () => {
  assert.deepEqual(validateEvidence(evidence()), { ok: true, errors: [] });
});

test('rejects missing provenance fields', () => {
  const result = validateEvidence(evidence({ sourceId: '' }));
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /sourceId/);
});

test('rejects synthetic evidence labeled live', () => {
  const result = validateEvidence(evidence({ synthetic: true, live: true }));
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /synthetic evidence cannot be labeled live/);
});

test('rejects a dependency edge without provenance', () => {
  const result = validateDependencyEdge({
    operator: 'operator.example',
    capability: 'casino',
    provider: 'provider-x',
    component: 'rgs',
    confidence: 'LOW',
    evidenceIds: []
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /at least one evidence/);
});

test('rejects HIGH confidence with only one independent observed source', () => {
  const store = new Map([
    ['e1', evidence()],
    ['e2', evidence({ locator: 'https://example.com/second.js' })]
  ]);

  const result = validateDependencyEdge({
    operator: 'operator.example',
    capability: 'casino',
    provider: 'provider-x',
    component: 'rgs',
    confidence: 'HIGH',
    evidenceIds: ['e1', 'e2']
  }, store);

  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /two independent Observed evidence sources/);
});

test('accepts HIGH confidence with two independent observed sources', () => {
  const store = new Map([
    ['e1', evidence({ sourceId: 'network' })],
    ['e2', evidence({ sourceId: 'dns', locator: 'provider-x.example' })]
  ]);

  const result = validateDependencyEdge({
    operator: 'operator.example',
    capability: 'casino',
    provider: 'provider-x',
    component: 'rgs',
    confidence: 'HIGH',
    evidenceIds: ['e1', 'e2']
  }, store);

  assert.deepEqual(result, { ok: true, errors: [] });
});
