const AUTHORIZED = new Set(['AUTHORIZED_TEST_ACCOUNT', 'AUTHORIZED_INTEGRATION']);

function evidence(id, geo, observation, value, authorization) {
  return {
    id,
    pathStage: 'BONUS',
    geo,
    observation,
    value,
    provenance: {
      kind: 'authorized_test_or_integration',
      authorization,
      status: 'Observed'
    }
  };
}

export function classifyBonusFlow(input = {}) {
  const {
    authorization,
    geo,
    observations = {},
    controls = [],
    config = {},
    executionMode = 'READ_ONLY_OR_TEST'
  } = input;

  if (!AUTHORIZED.has(authorization)) {
    throw new Error('Bonus Flow requires an explicitly authorized test account or integration');
  }
  if (!geo) throw new Error('Bonus Flow requires GEO');
  if (executionMode !== 'READ_ONLY_OR_TEST') {
    throw new Error('Bonus Flow must not execute real-money or unauthorized actions');
  }

  const evidenceItems = Object.entries(observations).map(([key, value], index) =>
    evidence(`bonus-${index + 1}`, geo, key, value, authorization)
  );

  const base = {
    pathStage: 'BONUS',
    geo,
    dependency: null,
    dependencyEdges: [],
    cause: 'NOT_OBSERVABLE',
    confidence: 'GUARDED',
    evidence: evidenceItems,
    controls,
    savedGgr: null,
    savedRevenue: null,
    roiClaim: 'NOT_CLAIMED'
  };

  // Do not infer eligibility or a broken bonus merely from marketing visibility.
  if (observations.offerVisible === true && observations.eligibility === 'NOT_OBSERVABLE') {
    return { ...base, state: 'NOT_OBSERVABLE' };
  }

  // A configured expected offer that is repeatedly absent for an explicitly eligible
  // authorized test account is a path degradation, not provider/root-cause attribution.
  if (
    config.expectedOffer === true &&
    observations.eligibility === 'eligible' &&
    observations.offerVisible === false &&
    observations.repeated === true
  ) {
    return { ...base, state: 'DEGRADED' };
  }

  // Activation failure is only promoted when the authorized path is known to be eligible
  // and the failure is repeated/corroborated. One failed attempt remains ambiguous.
  if (
    observations.eligibility === 'eligible' &&
    observations.activation === 'failed' &&
    observations.repeated === true
  ) {
    return { ...base, state: 'BROKEN' };
  }

  if (
    observations.eligibility === 'eligible' &&
    observations.activation === 'failed' &&
    observations.repeated !== true
  ) {
    return { ...base, state: 'NOT_OBSERVABLE' };
  }

  // Credit/award state may be opaque even when the visible activation step succeeds.
  if (
    observations.activation === 'success' &&
    (observations.credit === 'NOT_OBSERVABLE' || observations.credit == null)
  ) {
    return { ...base, state: 'NOT_OBSERVABLE' };
  }

  if (
    observations.eligibility === 'eligible' &&
    observations.offerVisible === true &&
    observations.activation === 'success' &&
    observations.credit === 'applied_test_balance'
  ) {
    return { ...base, state: 'HEALTHY' };
  }

  return { ...base, state: 'NOT_OBSERVABLE' };
}
