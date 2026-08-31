const AUTHORIZED = new Set(['AUTHORIZED_TEST_ACCOUNT', 'AUTHORIZED_INTEGRATION']);

function isObservedRecord(record, { geo, subjectId, authorizationEvidenceId } = {}) {
  return Boolean(
    record &&
    typeof record.id === 'string' && record.id &&
    typeof record.source === 'string' && record.source &&
    typeof record.timestamp === 'string' && record.timestamp &&
    record.status === 'Observed' &&
    record.geo === geo &&
    record.subjectId === subjectId &&
    record.authorizationEvidenceId === authorizationEvidenceId &&
    typeof record.observation === 'string' && record.observation
  );
}

function validAuthorizationContext(authorization, geo, context = {}) {
  const evidence = context.evidence || {};
  return Boolean(
    context.authorization === authorization &&
    typeof context.subjectId === 'string' && context.subjectId &&
    evidence.status === 'Observed' &&
    typeof evidence.id === 'string' && evidence.id &&
    typeof evidence.source === 'string' && evidence.source &&
    typeof evidence.timestamp === 'string' && evidence.timestamp &&
    evidence.geo === geo &&
    evidence.subjectId === context.subjectId &&
    evidence.authorization === authorization
  );
}

function buildEvidence(record, authorization) {
  return {
    id: record.id,
    pathStage: 'BONUS',
    geo: record.geo,
    observation: record.observation,
    value: record.value,
    source: record.source,
    timestamp: record.timestamp,
    subjectId: record.subjectId,
    authorizationEvidenceId: record.authorizationEvidenceId,
    provenance: {
      kind: 'authorized_test_or_integration',
      authorization,
      source: record.source,
      status: 'Observed'
    }
  };
}

function values(records, observation) {
  return records.filter((item) => item.observation === observation).map((item) => item.value);
}

function observed(records, observation, value) {
  return records.some((item) => item.observation === observation && item.value === value);
}

function repeatedObserved(records, observation, value) {
  const matches = records.filter((item) => item.observation === observation && item.value === value);
  const identities = new Set(matches.map((item) => `${item.id}|${item.timestamp}`));
  return identities.size >= 2;
}

function hasContradiction(records, observation, expectedValue) {
  const seen = values(records, observation);
  return seen.some((value) => value !== expectedValue);
}

export function classifyBonusFlow(input = {}) {
  const {
    authorization,
    authorizationContext = {},
    geo,
    observationRecords = [],
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

  const base = {
    pathStage: 'BONUS',
    geo,
    dependency: null,
    dependencyEdges: [],
    cause: 'NOT_OBSERVABLE',
    confidence: 'GUARDED',
    evidence: [],
    controls,
    savedGgr: null,
    savedRevenue: null,
    roiClaim: 'NOT_CLAIMED'
  };

  if (!validAuthorizationContext(authorization, geo, authorizationContext)) {
    return { ...base, state: 'NOT_OBSERVABLE' };
  }

  const authorizationEvidenceId = authorizationContext.evidence.id;
  const validRecords = observationRecords.filter((record) =>
    isObservedRecord(record, {
      geo,
      subjectId: authorizationContext.subjectId,
      authorizationEvidenceId
    })
  );
  const evidenceItems = validRecords.map((record) => buildEvidence(record, authorization));
  const evidencedBase = { ...base, evidence: evidenceItems };

  if (validRecords.length === 0) {
    return { ...evidencedBase, state: 'NOT_OBSERVABLE' };
  }

  // Marketing visibility alone never proves eligibility or health.
  if (observed(validRecords, 'offerVisible', true) && !observed(validRecords, 'eligibility', 'eligible')) {
    return { ...evidencedBase, state: 'NOT_OBSERVABLE' };
  }

  // A configured expected offer is degraded only when eligibility is observed and
  // offer absence is independently repeated by two distinct timestamped observations.
  if (
    config.expectedOffer === true &&
    observed(validRecords, 'eligibility', 'eligible') &&
    repeatedObserved(validRecords, 'offerVisible', false) &&
    !hasContradiction(validRecords, 'eligibility', 'eligible')
  ) {
    return { ...evidencedBase, state: 'DEGRADED' };
  }

  // Activation failure is promoted only when eligibility is observed and the failed
  // activation is corroborated by at least two distinct timestamped observations.
  if (
    observed(validRecords, 'eligibility', 'eligible') &&
    repeatedObserved(validRecords, 'activation', 'failed') &&
    !hasContradiction(validRecords, 'eligibility', 'eligible') &&
    !hasContradiction(validRecords, 'activation', 'failed')
  ) {
    return { ...evidencedBase, state: 'BROKEN' };
  }

  if (observed(validRecords, 'activation', 'failed')) {
    return { ...evidencedBase, state: 'NOT_OBSERVABLE' };
  }

  // Healthy requires provenance-backed evidence for every visible step and no
  // contradictory evidence for those observations.
  if (
    observed(validRecords, 'eligibility', 'eligible') &&
    observed(validRecords, 'offerVisible', true) &&
    observed(validRecords, 'activation', 'success') &&
    observed(validRecords, 'credit', 'applied_test_balance') &&
    !hasContradiction(validRecords, 'eligibility', 'eligible') &&
    !hasContradiction(validRecords, 'offerVisible', true) &&
    !hasContradiction(validRecords, 'activation', 'success') &&
    !hasContradiction(validRecords, 'credit', 'applied_test_balance')
  ) {
    return { ...evidencedBase, state: 'HEALTHY' };
  }

  return { ...evidencedBase, state: 'NOT_OBSERVABLE' };
}
