export const gameRgsFixtures = [
  {
    id: 'healthy-authorized-game-launch',
    authorization: 'PUBLIC_OR_AUTHORIZED_SANDBOX',
    geo: 'DE',
    observations: { launch: 'success', runtime: 'healthy' },
    controls: [{ type: 'same-operator-control-game', state: 'HEALTHY' }],
    expected: { state: 'HEALTHY' }
  },
  {
    id: 'single-failed-launch-with-provider-label-is-ambiguous',
    authorization: 'PUBLIC_OR_AUTHORIZED_SANDBOX',
    geo: 'SE',
    observations: { launch: 'failed', providerLabel: 'ExampleProvider', runtimeHost: 'games.example-provider.test' },
    controls: [{ type: 'same-operator-control-game', state: 'HEALTHY' }],
    expected: { state: 'NOT_OBSERVABLE' }
  },
  {
    id: 'repeated-game-failure-with-healthy-control-is-broken-without-provider-cause',
    authorization: 'AUTHORIZED_SANDBOX',
    geo: 'GB',
    observations: { launch: 'failed', repeated: true, healthyControl: true, providerLabel: 'ExampleProvider' },
    controls: [{ type: 'same-operator-control-game', state: 'HEALTHY' }],
    expected: { state: 'BROKEN' }
  },
  {
    id: 'corroborated-cross-operator-provider-path-failure',
    authorization: 'AUTHORIZED_SANDBOX',
    geo: 'FI',
    observations: { launch: 'failed', providerLabel: 'ExampleProvider', requestedConfidence: 'HIGH' },
    correlation: {
      provider: 'ExampleProvider',
      runtimeHostCorroborated: true,
      sameFailureSignature: true,
      independentOperators: 2,
      healthyControl: true
    },
    controls: [{ type: 'independent-provider-control', state: 'HEALTHY' }],
    expected: { state: 'BROKEN' }
  },
  {
    id: 'marketing-provider-reference-does-not-create-edge',
    authorization: 'PUBLIC_OR_AUTHORIZED_SANDBOX',
    geo: 'NL',
    observations: { launch: 'failed', providerLabel: 'ExampleProvider', marketingLink: 'https://example.test/provider/example' },
    correlation: { provider: 'ExampleProvider', independentOperators: 3 },
    expected: { state: 'NOT_OBSERVABLE' }
  },
  {
    id: 'repeated-runtime-degradation',
    authorization: 'AUTHORIZED_SANDBOX',
    geo: 'CA',
    observations: { launch: 'success', runtime: 'degraded', repeated: true },
    controls: [{ type: 'same-operator-control-game', state: 'HEALTHY' }],
    expected: { state: 'DEGRADED' }
  }
];
