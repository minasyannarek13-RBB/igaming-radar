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
      assert.ok(['fixture_or_authorized_probe', 'authorized_runtime_probe'].includes(item.provenance.kind));
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

test('provenance-backed cross-operator runtime correlation may create one guarded provider dependency edge', () => {
  const result = classifyGameRgsFlow({
    authorization: 'AUTHORIZED_SANDBOX',
    geo: 'FI',
    observations: { launch: 'failed', providerLabel: 'ExampleProvider', requestedConfidence: 'HIGH' },
    correlation: {
      provider: 'ExampleProvider',
      operatorEvidence: [
        {
          operatorId: 'operator-a',
          runtimeHost: 'rgs-a.example-provider.test',
          provider: 'ExampleProvider',
          providerRuntimeBinding: 'OBSERVED_RUNTIME_HOST',
          launch: 'failed',
          failureSignature: 'launch-timeout-v1',
          provenance: { kind: 'authorized_runtime_probe', status: 'Observed', source: 'probe-a-001' }
        },
        {
          operatorId: 'operator-b',
          runtimeHost: 'rgs-b.example-provider.test',
          provider: 'ExampleProvider',
          providerRuntimeBinding: 'OBSERVED_RUNTIME_HOST',
          launch: 'failed',
          failureSignature: 'launch-timeout-v1',
          provenance: { kind: 'authorized_runtime_probe', status: 'Observed', source: 'probe-b-001' }
        }
      ],
      healthyControlEvidence: {
        controlId: 'provider-control',
        state: 'HEALTHY',
        provenance: { kind: 'authorized_runtime_probe', status: 'Observed', source: 'control-001' }
      }
    }
  });
  assert.equal(result.state, 'BROKEN');
  assert.equal(result.cause, 'PROVIDER_PATH_FAILURE_CORROBORATED');
  assert.equal(result.dependency.name, 'ExampleProvider');
  assert.equal(result.confidence, 'GUARDED');
  assert.equal(result.dependencyEdges.length, 1);
  assert.equal(result.dependencyEdges[0].confidence, 'GUARDED');
  assert.equal(result.evidence.filter((item) => item.observation === 'provider_runtime_failure').length, 2);
  assert.equal(result.evidence.filter((item) => item.observation === 'healthy_control').length, 1);
});

test('release blocker #12: self-asserted correlation booleans cannot create a provider edge', () => {
  const result = classifyGameRgsFlow({
    authorization: 'AUTHORIZED_SANDBOX',
    geo: 'FI',
    observations: { launch: 'failed' },
    correlation: {
      provider: 'ArbitraryProvider',
      runtimeHostCorroborated: true,
      sameFailureSignature: true,
      independentOperators: 2,
      healthyControl: true
    }
  });
  assert.equal(result.state, 'NOT_OBSERVABLE');
  assert.equal(result.cause, 'NOT_OBSERVABLE');
  assert.equal(result.dependency, null);
  assert.deepEqual(result.dependencyEdges, []);
  assert.equal(result.confidence, 'GUARDED');
  assert.equal(result.evidence.some((item) => item.observation === 'correlation'), false);
});

test('same signature must be derived from records from distinct operators', () => {
  const result = classifyGameRgsFlow({
    authorization: 'AUTHORIZED_SANDBOX',
    geo: 'FI',
    observations: { launch: 'failed' },
    correlation: {
      provider: 'ExampleProvider',
      operatorEvidence: [
        {
          operatorId: 'operator-a', runtimeHost: 'a.test', provider: 'ExampleProvider',
          providerRuntimeBinding: 'OBSERVED_RUNTIME_HOST', launch: 'failed', failureSignature: 'sig-a',
          provenance: { kind: 'authorized_runtime_probe', status: 'Observed', source: 'a-1' }
        },
        {
          operatorId: 'operator-b', runtimeHost: 'b.test', provider: 'ExampleProvider',
          providerRuntimeBinding: 'OBSERVED_RUNTIME_HOST', launch: 'failed', failureSignature: 'sig-b',
          provenance: { kind: 'authorized_runtime_probe', status: 'Observed', source: 'b-1' }
        }
      ],
      healthyControlEvidence: {
        controlId: 'control', state: 'HEALTHY',
        provenance: { kind: 'authorized_runtime_probe', status: 'Observed', source: 'c-1' }
      }
    }
  });
  assert.equal(result.state, 'NOT_OBSERVABLE');
  assert.deepEqual(result.dependencyEdges, []);
});

test('provider binding and healthy-control provenance are mandatory for attribution', () => {
  const result = classifyGameRgsFlow({
    authorization: 'AUTHORIZED_SANDBOX',
    geo: 'FI',
    observations: { launch: 'failed' },
    correlation: {
      provider: 'ExampleProvider',
      operatorEvidence: [
        {
          operatorId: 'operator-a', runtimeHost: 'a.test', provider: 'ExampleProvider', launch: 'failed', failureSignature: 'sig',
          provenance: { kind: 'authorized_runtime_probe', status: 'Observed', source: 'a-1' }
        },
        {
          operatorId: 'operator-b', runtimeHost: 'b.test', provider: 'ExampleProvider', launch: 'failed', failureSignature: 'sig',
          provenance: { kind: 'authorized_runtime_probe', status: 'Observed', source: 'b-1' }
        }
      ],
      healthyControlEvidence: { controlId: 'control', state: 'HEALTHY' }
    }
  });
  assert.equal(result.state, 'NOT_OBSERVABLE');
  assert.equal(result.dependency, null);
  assert.deepEqual(result.dependencyEdges, []);
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
