const AUTHORIZED = new Set(['PUBLIC_OR_AUTHORIZED_SANDBOX', 'AUTHORIZED_SANDBOX']);

function makeEvidence(id, geo, observation, value) {
  return {
    id,
    pathStage: 'GAME_SPORTSBOOK',
    geo,
    observation,
    value,
    provenance: {
      kind: 'fixture_or_authorized_probe',
      status: 'Observed'
    }
  };
}

function validatedProviderCorrelation(correlation = {}) {
  return Boolean(
    correlation.provider &&
    correlation.runtimeHostCorroborated === true &&
    correlation.sameFailureSignature === true &&
    Number(correlation.independentOperators) >= 2 &&
    correlation.healthyControl === true
  );
}

export function classifyGameRgsFlow(input = {}) {
  const { authorization, geo, observations = {}, controls = [], correlation = {} } = input;
  if (!AUTHORIZED.has(authorization)) {
    throw new Error('Game/RGS Flow requires public or explicitly authorized sandbox evidence');
  }
  if (!geo) throw new Error('Game/RGS Flow requires GEO');

  const evidence = Object.entries(observations).map(([key, value], index) =>
    makeEvidence(`game-${index + 1}`, geo, key, value)
  );

  if (Object.keys(correlation).length) {
    evidence.push(makeEvidence('game-correlation', geo, 'correlation', correlation));
  }

  const base = {
    pathStage: 'GAME_SPORTSBOOK',
    geo,
    dependency: null,
    dependencyEdges: [],
    cause: 'NOT_OBSERVABLE',
    confidence: 'GUARDED',
    evidence,
    controls,
    savedGgr: null,
    savedRevenue: null,
    roiClaim: 'NOT_CLAIMED'
  };

  // A provider label, marketing link or a single runtime host observation is not enough
  // to claim a provider dependency or root cause.
  if (observations.launch === 'failed' && observations.repeated !== true && !validatedProviderCorrelation(correlation)) {
    return { ...base, state: 'NOT_OBSERVABLE' };
  }

  // A repeated game launch failure with an explicitly healthy control establishes a broken
  // revenue path, but still does not identify the provider as the cause.
  if (observations.launch === 'failed' && observations.repeated === true && observations.healthyControl === true) {
    return { ...base, state: 'BROKEN' };
  }

  // Provider attribution is allowed only with independent cross-operator corroboration,
  // same failure signature, a healthy control and runtime-host evidence. Confidence remains
  // guarded; callers cannot promote it to HIGH merely by requesting HIGH.
  if (observations.launch === 'failed' && validatedProviderCorrelation(correlation)) {
    const dependency = {
      type: 'GAME_PROVIDER_RGS',
      name: correlation.provider,
      basis: 'runtime_host_cross_operator_corroboration'
    };
    return {
      ...base,
      state: 'BROKEN',
      cause: 'PROVIDER_PATH_FAILURE_CORROBORATED',
      dependency,
      dependencyEdges: [{ from: 'GAME_SPORTSBOOK', to: correlation.provider, evidence: 'CORROBORATED', confidence: 'GUARDED' }]
    };
  }

  if (observations.launch === 'success' && observations.runtime === 'healthy') {
    return { ...base, state: 'HEALTHY' };
  }

  if (observations.launch === 'success' && observations.runtime === 'degraded' && observations.repeated === true) {
    return { ...base, state: 'DEGRADED' };
  }

  return { ...base, state: 'NOT_OBSERVABLE' };
}
