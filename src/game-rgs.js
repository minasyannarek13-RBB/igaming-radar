const AUTHORIZED = new Set(['PUBLIC_OR_AUTHORIZED_SANDBOX', 'AUTHORIZED_SANDBOX']);
const OBSERVED_PROVENANCE_KINDS = new Set(['fixture_or_authorized_probe', 'authorized_runtime_probe']);

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

function hasObservedProvenance(record = {}) {
  return Boolean(
    record.provenance &&
    record.provenance.status === 'Observed' &&
    OBSERVED_PROVENANCE_KINDS.has(record.provenance.kind) &&
    typeof record.provenance.source === 'string' &&
    record.provenance.source.length > 0
  );
}

function validatedProviderCorrelation(correlation = {}) {
  const provider = correlation.provider;
  const operatorEvidence = Array.isArray(correlation.operatorEvidence)
    ? correlation.operatorEvidence
    : [];
  const healthyControlEvidence = correlation.healthyControlEvidence;

  if (!provider || operatorEvidence.length < 2) return null;

  const validOperatorEvidence = operatorEvidence.filter((record) =>
    record &&
    typeof record.operatorId === 'string' && record.operatorId.length > 0 &&
    typeof record.runtimeHost === 'string' && record.runtimeHost.length > 0 &&
    record.provider === provider &&
    record.providerRuntimeBinding === 'OBSERVED_RUNTIME_HOST' &&
    record.launch === 'failed' &&
    typeof record.failureSignature === 'string' && record.failureSignature.length > 0 &&
    hasObservedProvenance(record)
  );

  const distinctOperators = new Set(validOperatorEvidence.map((record) => record.operatorId));
  if (distinctOperators.size < 2) return null;

  const signatures = new Set(validOperatorEvidence.map((record) => record.failureSignature));
  if (signatures.size !== 1) return null;

  if (!(
    healthyControlEvidence &&
    healthyControlEvidence.state === 'HEALTHY' &&
    typeof healthyControlEvidence.controlId === 'string' && healthyControlEvidence.controlId.length > 0 &&
    hasObservedProvenance(healthyControlEvidence)
  )) {
    return null;
  }

  return {
    provider,
    failureSignature: validOperatorEvidence[0].failureSignature,
    operatorEvidence: validOperatorEvidence,
    healthyControlEvidence
  };
}

function correlationEvidence(validatedCorrelation, geo) {
  if (!validatedCorrelation) return [];
  const operatorEvidence = validatedCorrelation.operatorEvidence.map((record, index) => ({
    id: `game-provider-correlation-${index + 1}`,
    pathStage: 'GAME_SPORTSBOOK',
    geo,
    observation: 'provider_runtime_failure',
    value: {
      operatorId: record.operatorId,
      runtimeHost: record.runtimeHost,
      provider: record.provider,
      providerRuntimeBinding: record.providerRuntimeBinding,
      launch: record.launch,
      failureSignature: record.failureSignature
    },
    provenance: record.provenance
  }));

  operatorEvidence.push({
    id: 'game-provider-control',
    pathStage: 'GAME_SPORTSBOOK',
    geo,
    observation: 'healthy_control',
    value: {
      controlId: validatedCorrelation.healthyControlEvidence.controlId,
      state: validatedCorrelation.healthyControlEvidence.state
    },
    provenance: validatedCorrelation.healthyControlEvidence.provenance
  });

  return operatorEvidence;
}

export function classifyGameRgsFlow(input = {}) {
  const { authorization, geo, observations = {}, controls = [], correlation = {} } = input;
  if (!AUTHORIZED.has(authorization)) {
    throw new Error('Game/RGS Flow requires public or explicitly authorized sandbox evidence');
  }
  if (!geo) throw new Error('Game/RGS Flow requires GEO');

  const validatedCorrelation = validatedProviderCorrelation(correlation);
  const evidence = Object.entries(observations).map(([key, value], index) =>
    makeEvidence(`game-${index + 1}`, geo, key, value)
  );
  evidence.push(...correlationEvidence(validatedCorrelation, geo));

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

  // A provider label, marketing link, single runtime host or caller-supplied correlation
  // booleans are not enough to claim a provider dependency or root cause.
  if (observations.launch === 'failed' && observations.repeated !== true && !validatedCorrelation) {
    return { ...base, state: 'NOT_OBSERVABLE' };
  }

  // A repeated game launch failure with an explicitly healthy control establishes a broken
  // revenue path, but still does not identify the provider as the cause.
  if (observations.launch === 'failed' && observations.repeated === true && observations.healthyControl === true) {
    return { ...base, state: 'BROKEN' };
  }

  // Provider attribution requires provenance-backed runtime observations from at least two
  // distinct operators, the same failure signature derived from those records, runtime-host
  // binding to the provider, and a separate observed healthy control. Confidence stays guarded.
  if (observations.launch === 'failed' && validatedCorrelation) {
    const dependency = {
      type: 'GAME_PROVIDER_RGS',
      name: validatedCorrelation.provider,
      basis: 'provenance_backed_runtime_host_cross_operator_corroboration'
    };
    return {
      ...base,
      state: 'BROKEN',
      cause: 'PROVIDER_PATH_FAILURE_CORROBORATED',
      dependency,
      dependencyEdges: [{
        from: 'GAME_SPORTSBOOK',
        to: validatedCorrelation.provider,
        evidence: 'CORROBORATED',
        confidence: 'GUARDED'
      }]
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
