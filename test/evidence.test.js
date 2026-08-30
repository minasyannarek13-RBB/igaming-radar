import test from 'node:test';
import assert from 'node:assert/strict';

import {
  OBSERVATION_STATES,
  PROVENANCE_FAMILIES,
  provenanceFamily,
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

test('rejects invalid provenanceChannel when supplied', () => {
  const result = validateEvidence(evidence({ provenanceChannel: '   ' }));
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /provenanceChannel/);
});

test('rejects arbitrary provenanceChannel families', () => {
  const result = validateEvidence(evidence({ provenanceChannel: 'runtime_resource_http_fake:provider-x' }));
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /provenanceChannel family/);
});

test('normalizes channel labels to trusted provenance family', () => {
  assert.equal(provenanceFamily('runtime_resource_http:A'), PROVENANCE_FAMILIES.RUNTIME_RESOURCE_HTTP);
  assert.equal(provenanceFamily('runtime_resource_http:B'), PROVENANCE_FAMILIES.RUNTIME_RESOURCE_HTTP);
  assert.equal(provenanceFamily('unknown:A'), null);
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

test('rejects HIGH confidence when distinct sourceIds are from the same provenance channel', () => {
  const store = new Map([
    ['e1', evidence({ sourceId: 'runtime:https://provider.example/a.js', provenanceChannel: 'runtime_resource_http:provider-x' })],
    ['e2', evidence({ sourceId: 'runtime:https://provider.example/b.js', locator: 'https://provider.example/b.js', provenanceChannel: 'runtime_resource_http:provider-x' })]
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
  assert.match(result.errors.join(' '), /two independent trusted Observed provenance families/);
});

test('rejects HIGH confidence when attacker varies channel suffix within one real family', () => {
  const store = new Map([
    ['e1', evidence({ sourceId: 'runtime:https://provider.example/a.js', provenanceChannel: 'runtime_resource_http:A' })],
    ['e2', evidence({ sourceId: 'runtime:https://provider.example/b.js', locator: 'https://provider.example/b.js', provenanceChannel: 'runtime_resource_http:B' })]
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
  assert.match(result.errors.join(' '), /two independent trusted Observed provenance families/);
});

test('rejects HIGH confidence when provenance channels are not explicitly declared', () => {
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

  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /two independent trusted Observed provenance families/);
});

test('rejects HIGH confidence with an arbitrary second provenance family label', () => {
  const store = new Map([
    ['e1', evidence({ sourceId: 'runtime', provenanceChannel: 'runtime_resource_http:provider-x' })],
    ['e2', evidence({ sourceId: 'runtime-2', locator: 'https://provider.example/b.js', provenanceChannel: 'runtime_resource_http_fake:provider-x' })]
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
  assert.match(result.errors.join(' '), /invalid evidence e2: invalid provenanceChannel family/);
  assert.match(result.errors.join(' '), /two independent trusted Observed provenance families/);
});

test('accepts HIGH confidence with two explicitly independent trusted observed provenance families', () => {
  const store = new Map([
    ['e1', evidence({ sourceId: 'runtime', provenanceChannel: 'runtime_resource_http:provider-x' })],
    ['e2', evidence({ sourceId: 'authoritative-dns', locator: 'provider-x.example', evidenceClass: 'dns', provenanceChannel: 'authoritative_dns:provider-x' })]
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
