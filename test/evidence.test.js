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

function runtimeEvidence(overrides = {}) {
  return evidence({
    sourceId: 'runtime_resource_http:https://provider.example/a.js',
    locator: 'https://provider.example/a.js',
    evidenceClass: 'runtime_resource_http',
    provenanceChannel: 'runtime_resource_http:provider-x',
    requestedUrl: 'https://provider.example/a.js',
    finalUrl: 'https://provider.example/a.js',
    finalHostname: 'provider.example',
    httpStatus: 200,
    ...overrides
  });
}

function dnsEvidence(overrides = {}) {
  return evidence({
    sourceId: 'authoritative_dns:provider-x.example',
    locator: 'provider-x.example',
    evidenceClass: 'authoritative_dns',
    provenanceChannel: 'authoritative_dns:provider-x',
    dnsName: 'provider-x.example',
    dnsAnswers: ['203.0.113.10'],
    authoritative: true,
    ...overrides
  });
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
    ['e1', runtimeEvidence()],
    ['e2', runtimeEvidence({ sourceId: 'runtime_resource_http:https://provider.example/b.js', locator: 'https://provider.example/b.js', requestedUrl: 'https://provider.example/b.js', finalUrl: 'https://provider.example/b.js' })]
  ]);

  const result = validateDependencyEdge({ operator: 'operator.example', capability: 'casino', provider: 'provider-x', component: 'rgs', confidence: 'HIGH', evidenceIds: ['e1', 'e2'] }, store);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /two independently bound trusted Observed provenance families/);
});

test('rejects HIGH confidence when attacker varies channel suffix within one real family', () => {
  const store = new Map([
    ['e1', runtimeEvidence({ provenanceChannel: 'runtime_resource_http:A' })],
    ['e2', runtimeEvidence({ sourceId: 'runtime_resource_http:https://provider.example/b.js', locator: 'https://provider.example/b.js', requestedUrl: 'https://provider.example/b.js', finalUrl: 'https://provider.example/b.js', provenanceChannel: 'runtime_resource_http:B' })]
  ]);

  const result = validateDependencyEdge({ operator: 'operator.example', capability: 'casino', provider: 'provider-x', component: 'rgs', confidence: 'HIGH', evidenceIds: ['e1', 'e2'] }, store);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /two independently bound trusted Observed provenance families/);
});

test('rejects HIGH confidence when provenance channels are not explicitly declared', () => {
  const store = new Map([
    ['e1', evidence({ sourceId: 'network' })],
    ['e2', evidence({ sourceId: 'dns', locator: 'provider-x.example' })]
  ]);

  const result = validateDependencyEdge({ operator: 'operator.example', capability: 'casino', provider: 'provider-x', component: 'rgs', confidence: 'HIGH', evidenceIds: ['e1', 'e2'] }, store);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /two independently bound trusted Observed provenance families/);
});

test('rejects HIGH confidence with an arbitrary second provenance family label', () => {
  const store = new Map([
    ['e1', runtimeEvidence()],
    ['e2', runtimeEvidence({ sourceId: 'runtime_resource_http_fake:https://provider.example/b.js', provenanceChannel: 'runtime_resource_http_fake:provider-x' })]
  ]);

  const result = validateDependencyEdge({ operator: 'operator.example', capability: 'casino', provider: 'provider-x', component: 'rgs', confidence: 'HIGH', evidenceIds: ['e1', 'e2'] }, store);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /invalid evidence e2: invalid provenanceChannel family/);
});

test('rejects relabeled runtime HTTP evidence pretending to be authoritative DNS', () => {
  const store = new Map([
    ['e1', runtimeEvidence()],
    ['e2', runtimeEvidence({
      sourceId: 'runtime_resource_http:https://provider.example/b.js',
      locator: 'https://provider.example/b.js',
      requestedUrl: 'https://provider.example/b.js',
      finalUrl: 'https://provider.example/b.js',
      provenanceChannel: 'authoritative_dns:provider-x'
    })]
  ]);

  const result = validateDependencyEdge({ operator: 'operator.example', capability: 'casino', provider: 'provider-x', component: 'rgs', confidence: 'HIGH', evidenceIds: ['e1', 'e2'] }, store);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /does not match sourceId sensor family/);
  assert.match(result.errors.join(' '), /authoritative_dns provenance requires authoritative_dns evidenceClass/);
  assert.match(result.errors.join(' '), /two independently bound trusted Observed provenance families/);
});

test('rejects DNS provenance without authoritative sensor fields', () => {
  const result = validateEvidence(evidence({
    sourceId: 'authoritative_dns:provider-x.example',
    locator: 'provider-x.example',
    evidenceClass: 'authoritative_dns',
    provenanceChannel: 'authoritative_dns:provider-x'
  }));
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /dnsName/);
  assert.match(result.errors.join(' '), /dnsAnswers/);
  assert.match(result.errors.join(' '), /authoritative=true/);
});

test('accepts HIGH confidence with two schema-bound trusted observed provenance families', () => {
  const store = new Map([
    ['e1', runtimeEvidence()],
    ['e2', dnsEvidence()]
  ]);

  const result = validateDependencyEdge({ operator: 'operator.example', capability: 'casino', provider: 'provider-x', component: 'rgs', confidence: 'HIGH', evidenceIds: ['e1', 'e2'] }, store);
  assert.deepEqual(result, { ok: true, errors: [] });
});
