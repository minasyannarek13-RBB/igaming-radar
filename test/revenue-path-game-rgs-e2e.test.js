import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyGameRgsFlow } from '../src/game-rgs.js';
import { gameRgsFixtures } from './fixtures/revenue-path-game-rgs.js';

const byId = Object.fromEntries(gameRgsFixtures.map((fixture) => [fixture.id, fixture]));

function classify(id) {
  const fixture = byId[id];
  assert.ok(fixture, `missing fixture ${id}`);
  return classifyGameRgsFlow(fixture);
}

test('Game/RGS deterministic fixtures preserve expected state and factual ROI contract', () => {
  for (const fixture of gameRgsFixtures) {
    const result = classifyGameRgsFlow(fixture);
    assert.equal(result.state, fixture.expected.state, fixture.id);
    assert.equal(result.pathStage, 'GAME_SPORTSBOOK', fixture.id);
    assert.equal(result.geo, fixture.geo, fixture.id);
    assert.equal(result.savedGgr, null, fixture.id);
    assert.equal(result.savedRevenue, null, fixture.id);
    assert.equal(result.roiClaim, 'NOT_CLAIMED', fixture.id);
    assert.equal(result.confidence, 'GUARDED', fixture.id);
  }
});

test('single launch failure and marketing/self-asserted correlation create no provider edge', () => {
  for (const id of [
    'single-failed-launch-with-provider-label-is-ambiguous',
    'self-asserted-correlation-booleans-do-not-create-edge',
    'marketing-provider-reference-does-not-create-edge'
  ]) {
    const result = classify(id);
    assert.equal(result.state, 'NOT_OBSERVABLE');
    assert.equal(result.dependency, null);
    assert.deepEqual(result.dependencyEdges, []);
    assert.equal(result.cause, 'NOT_OBSERVABLE');
  }
});

test('repeated launch failure with healthy control is BROKEN without fabricated provider cause', () => {
  const result = classify('repeated-game-failure-with-healthy-control-is-broken-without-provider-cause');
  assert.equal(result.state, 'BROKEN');
  assert.equal(result.dependency, null);
  assert.deepEqual(result.dependencyEdges, []);
  assert.equal(result.cause, 'NOT_OBSERVABLE');
});

test('cross-operator provider attribution requires provenance-backed runtime evidence and remains guarded', () => {
  const result = classify('corroborated-cross-operator-provider-path-failure');
  assert.equal(result.state, 'BROKEN');
  assert.equal(result.cause, 'PROVIDER_PATH_FAILURE_CORROBORATED');
  assert.deepEqual(result.dependency, {
    type: 'GAME_PROVIDER_RGS',
    name: 'ExampleProvider',
    basis: 'provenance_backed_runtime_host_cross_operator_corroboration'
  });
  assert.equal(result.dependencyEdges.length, 1);
  assert.equal(result.dependencyEdges[0].confidence, 'GUARDED');
  assert.notEqual(result.dependencyEdges[0].confidence, 'HIGH');

  const correlationEvidence = result.evidence.filter((item) =>
    item.observation === 'provider_runtime_failure' || item.observation === 'healthy_control'
  );
  assert.equal(correlationEvidence.length, 3);
  for (const item of correlationEvidence) {
    assert.equal(item.provenance.status, 'Observed');
    assert.ok(['authorized_runtime_probe', 'fixture_or_authorized_probe'].includes(item.provenance.kind));
    assert.ok(item.provenance.source);
  }
});

test('same operator duplicated twice cannot satisfy cross-operator correlation', () => {
  const base = byId['corroborated-cross-operator-provider-path-failure'];
  const first = base.correlation.operatorEvidence[0];
  const result = classifyGameRgsFlow({
    ...base,
    correlation: {
      ...base.correlation,
      operatorEvidence: [first, { ...first, provenance: { ...first.provenance, source: 'probe-a-002' } }]
    }
  });
  assert.equal(result.state, 'NOT_OBSERVABLE');
  assert.equal(result.dependency, null);
  assert.deepEqual(result.dependencyEdges, []);
});

test('different failure signatures cannot create a provider dependency edge', () => {
  const base = byId['corroborated-cross-operator-provider-path-failure'];
  const evidence = base.correlation.operatorEvidence;
  const result = classifyGameRgsFlow({
    ...base,
    correlation: {
      ...base.correlation,
      operatorEvidence: [evidence[0], { ...evidence[1], failureSignature: 'different-failure' }]
    }
  });
  assert.equal(result.state, 'NOT_OBSERVABLE');
  assert.equal(result.dependency, null);
  assert.deepEqual(result.dependencyEdges, []);
});

test('missing observed healthy control prevents provider attribution', () => {
  const base = byId['corroborated-cross-operator-provider-path-failure'];
  const result = classifyGameRgsFlow({
    ...base,
    correlation: { ...base.correlation, healthyControlEvidence: null }
  });
  assert.equal(result.state, 'NOT_OBSERVABLE');
  assert.equal(result.dependency, null);
  assert.deepEqual(result.dependencyEdges, []);
});

test('untrusted or missing provenance prevents provider attribution', () => {
  const base = byId['corroborated-cross-operator-provider-path-failure'];
  const evidence = base.correlation.operatorEvidence;
  for (const badProvenance of [
    { kind: 'caller_asserted', status: 'Observed', source: 'fake' },
    { kind: 'authorized_runtime_probe', status: 'Inferred', source: 'probe' },
    { kind: 'authorized_runtime_probe', status: 'Observed' }
  ]) {
    const result = classifyGameRgsFlow({
      ...base,
      correlation: {
        ...base.correlation,
        operatorEvidence: [{ ...evidence[0], provenance: badProvenance }, evidence[1]]
      }
    });
    assert.equal(result.state, 'NOT_OBSERVABLE');
    assert.equal(result.dependency, null);
    assert.deepEqual(result.dependencyEdges, []);
  }
});

test('healthy and repeated degraded launches remain dependency-free', () => {
  const healthy = classify('healthy-authorized-game-launch');
  assert.equal(healthy.state, 'HEALTHY');
  assert.equal(healthy.dependency, null);
  assert.deepEqual(healthy.dependencyEdges, []);

  const degraded = classify('repeated-runtime-degradation');
  assert.equal(degraded.state, 'DEGRADED');
  assert.equal(degraded.dependency, null);
  assert.deepEqual(degraded.dependencyEdges, []);
});

test('unauthorized Game/RGS execution fails closed', () => {
  assert.throws(
    () => classifyGameRgsFlow({ authorization: 'UNAUTHORIZED', geo: 'GB', observations: { launch: 'success' } }),
    /public or explicitly authorized sandbox evidence/
  );
});
