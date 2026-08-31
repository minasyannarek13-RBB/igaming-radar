import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyGameRgsFlow } from '../src/game-rgs.js';
import { gameRgsFixtures } from './fixtures/revenue-path-game-rgs.js';

for (const fixture of gameRgsFixtures) {
  test(`game/RGS runtime classification: ${fixture.id}`, () => {
    const result = classifyGameRgsFlow(fixture);
    assert.equal(result.state, fixture.expected.state);
    assert.equal(result.pathStage, 'GAME_SPORTSBOOK');
    assert.equal(result.geo, fixture.geo);
    assert.equal(result.savedGgr, null);
    assert.equal(result.savedRevenue, null);
    assert.equal(result.roiClaim, 'NOT_CLAIMED');
    assert.ok(result.evidence.length > 0);
    for (const item of result.evidence) {
      assert.equal(item.provenance.status, 'Observed');
      assert.equal(item.provenance.kind, 'fixture_or_authorized_probe');
    }
  });
}

test('game/RGS runtime rejects unauthorized/private execution', () => {
  assert.throws(
    () => classifyGameRgsFlow({ authorization: 'PRIVATE_REAL_MONEY', geo: 'DE', observations: { launch: 'success' } }),
    /public or explicitly authorized sandbox evidence/
  );
});

test('single failed launch plus provider label/runtime host does not create provider attribution', () => {
  const result = classifyGameRgsFlow({
    authorization: 'PUBLIC_OR_AUTHORIZED_SANDBOX',
    geo: 'DE',
    observations: { launch: 'failed', providerLabel: 'ExampleProvider', runtimeHost: 'games.example-provider.test' }
  });
  assert.equal(result.state, 'NOT_OBSERVABLE');
  assert.equal(result.cause, 'NOT_OBSERVABLE');
  assert.equal(result.dependency, null);
  assert.deepEqual(result.dependencyEdges, []);
});

test('repeated failed launch with healthy control is BROKEN without unsupported provider cause', () => {
  const result = classifyGameRgsFlow({
    authorization: 'AUTHORIZED_SANDBOX',
    geo: 'GB',
    observations: { launch: 'failed', repeated: true, healthyControl: true, providerLabel: 'ExampleProvider' }
  });
  assert.equal(result.state, 'BROKEN');
  assert.equal(result.cause, 'NOT_OBSERVABLE');
  assert.equal(result.dependency, null);
  assert.deepEqual(result.dependencyEdges, []);
});

test('validated cross-operator runtime correlation may create one guarded provider dependency edge', () => {
  const result = classifyGameRgsFlow({
    authorization: 'AUTHORIZED_SANDBOX',
    geo: 'FI',
    observations: { launch: 'failed', providerLabel: 'ExampleProvider', requestedConfidence: 'HIGH' },
    correlation: {
      provider: 'ExampleProvider',
      runtimeHostCorroborated: true,
      sameFailureSignature: true,
      independentOperators: 2,
      healthyControl: true
    }
  });
  assert.equal(result.state, 'BROKEN');
  assert.equal(result.cause, 'PROVIDER_PATH_FAILURE_CORROBORATED');
  assert.equal(result.dependency.name, 'ExampleProvider');
  assert.equal(result.confidence, 'GUARDED');
  assert.equal(result.dependencyEdges.length, 1);
  assert.equal(result.dependencyEdges[0].confidence, 'GUARDED');
});

test('requested HIGH confidence is ignored when cross-operator evidence is incomplete', () => {
  const result = classifyGameRgsFlow({
    authorization: 'PUBLIC_OR_AUTHORIZED_SANDBOX',
    geo: 'NL',
    observations: { launch: 'failed', providerLabel: 'ExampleProvider', requestedConfidence: 'HIGH' },
    correlation: { provider: 'ExampleProvider', independentOperators: 4, sameFailureSignature: true }
  });
  assert.equal(result.state, 'NOT_OBSERVABLE');
  assert.equal(result.confidence, 'GUARDED');
  assert.equal(result.dependency, null);
  assert.deepEqual(result.dependencyEdges, []);
});
