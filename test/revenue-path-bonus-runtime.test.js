import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyBonusFlow } from '../src/bonus-flow.js';

const subjectId = 'test-account-1';
const authEvidenceId = 'auth-1';

const authorizationContext = {
  authorization: 'AUTHORIZED_TEST_ACCOUNT',
  subjectId,
  evidence: {
    id: authEvidenceId,
    source: 'operator-test-console',
    timestamp: '2026-08-31T04:00:00Z',
    geo: 'GB',
    subjectId,
    authorization: 'AUTHORIZED_TEST_ACCOUNT',
    status: 'Observed'
  }
};

const authorizedBase = {
  authorization: 'AUTHORIZED_TEST_ACCOUNT',
  authorizationContext,
  geo: 'GB',
  executionMode: 'READ_ONLY_OR_TEST'
};

function record(id, timestamp, observation, value, overrides = {}) {
  return {
    id,
    source: 'authorized-browser-fixture',
    timestamp,
    geo: 'GB',
    subjectId,
    authorizationEvidenceId: authEvidenceId,
    observation,
    value,
    status: 'Observed',
    ...overrides
  };
}

test('rejects public/untrusted bonus probing and real-money execution', () => {
  assert.throws(
    () => classifyBonusFlow({ ...authorizedBase, authorization: 'PUBLIC' }),
    /explicitly authorized test account or integration/
  );

  assert.throws(
    () => classifyBonusFlow({ ...authorizedBase, executionMode: 'REAL_MONEY' }),
    /must not execute real-money or unauthorized actions/
  );
});

test('authorization enum without provenance cannot promote state', () => {
  const result = classifyBonusFlow({
    authorization: 'AUTHORIZED_TEST_ACCOUNT',
    geo: 'GB',
    observations: {
      eligibility: 'eligible',
      activation: 'failed',
      repeated: true
    }
  });

  assert.equal(result.state, 'NOT_OBSERVABLE');
  assert.deepEqual(result.evidence, []);
});

test('raw caller observations and forged repeated=true are ignored', () => {
  const result = classifyBonusFlow({
    ...authorizedBase,
    observations: {
      eligibility: 'eligible',
      offerVisible: true,
      activation: 'failed',
      repeated: true,
      credit: 'applied_test_balance'
    }
  });

  assert.equal(result.state, 'NOT_OBSERVABLE');
  assert.deepEqual(result.evidence, []);
});

test('forged credit success without bound provenance cannot produce HEALTHY', () => {
  const result = classifyBonusFlow({
    ...authorizedBase,
    observationRecords: [
      record('elig-1', '2026-08-31T04:01:00Z', 'eligibility', 'eligible'),
      record('offer-1', '2026-08-31T04:01:10Z', 'offerVisible', true),
      record('activation-1', '2026-08-31T04:01:20Z', 'activation', 'success'),
      record('credit-1', '2026-08-31T04:01:30Z', 'credit', 'applied_test_balance', {
        authorizationEvidenceId: 'forged-auth'
      })
    ]
  });

  assert.equal(result.state, 'NOT_OBSERVABLE');
  assert.equal(result.evidence.some((item) => item.id === 'credit-1'), false);
});

test('marketing offer visibility alone cannot prove eligibility or health', () => {
  const result = classifyBonusFlow({
    ...authorizedBase,
    observationRecords: [record('offer-1', '2026-08-31T04:02:00Z', 'offerVisible', true)]
  });

  assert.equal(result.state, 'NOT_OBSERVABLE');
  assert.equal(result.dependency, null);
  assert.deepEqual(result.dependencyEdges, []);
  assert.equal(result.confidence, 'GUARDED');
});

test('one provenance-backed activation failure remains NOT_OBSERVABLE', () => {
  const result = classifyBonusFlow({
    ...authorizedBase,
    observationRecords: [
      record('elig-1', '2026-08-31T04:03:00Z', 'eligibility', 'eligible'),
      record('activation-1', '2026-08-31T04:03:10Z', 'activation', 'failed')
    ]
  });

  assert.equal(result.state, 'NOT_OBSERVABLE');
});

test('two distinct provenance-backed activation failures are BROKEN without root-cause attribution', () => {
  const result = classifyBonusFlow({
    ...authorizedBase,
    observationRecords: [
      record('elig-1', '2026-08-31T04:04:00Z', 'eligibility', 'eligible'),
      record('activation-1', '2026-08-31T04:04:10Z', 'activation', 'failed'),
      record('activation-2', '2026-08-31T04:05:10Z', 'activation', 'failed')
    ]
  });

  assert.equal(result.state, 'BROKEN');
  assert.equal(result.cause, 'NOT_OBSERVABLE');
  assert.equal(result.dependency, null);
  assert.deepEqual(result.dependencyEdges, []);
  assert.equal(result.confidence, 'GUARDED');
});

test('duplicate failure identity cannot fake corroboration', () => {
  const duplicate = record('activation-1', '2026-08-31T04:06:10Z', 'activation', 'failed');
  const result = classifyBonusFlow({
    ...authorizedBase,
    observationRecords: [
      record('elig-1', '2026-08-31T04:06:00Z', 'eligibility', 'eligible'),
      duplicate,
      { ...duplicate }
    ]
  });

  assert.equal(result.state, 'NOT_OBSERVABLE');
});

test('configured expected offer requires two distinct observed absences to become DEGRADED', () => {
  const result = classifyBonusFlow({
    ...authorizedBase,
    config: { expectedOffer: true },
    observationRecords: [
      record('elig-1', '2026-08-31T04:07:00Z', 'eligibility', 'eligible'),
      record('offer-1', '2026-08-31T04:07:10Z', 'offerVisible', false),
      record('offer-2', '2026-08-31T04:08:10Z', 'offerVisible', false)
    ]
  });

  assert.equal(result.state, 'DEGRADED');
  assert.equal(result.cause, 'NOT_OBSERVABLE');
});

test('contradictory activation evidence cannot be promoted to BROKEN', () => {
  const result = classifyBonusFlow({
    ...authorizedBase,
    observationRecords: [
      record('elig-1', '2026-08-31T04:09:00Z', 'eligibility', 'eligible'),
      record('activation-1', '2026-08-31T04:09:10Z', 'activation', 'failed'),
      record('activation-2', '2026-08-31T04:10:10Z', 'activation', 'failed'),
      record('activation-3', '2026-08-31T04:11:10Z', 'activation', 'success')
    ]
  });

  assert.equal(result.state, 'NOT_OBSERVABLE');
});

test('authorized test path is HEALTHY only with bound provenance for every required observation', () => {
  const result = classifyBonusFlow({
    ...authorizedBase,
    observationRecords: [
      record('elig-1', '2026-08-31T04:12:00Z', 'eligibility', 'eligible'),
      record('offer-1', '2026-08-31T04:12:10Z', 'offerVisible', true),
      record('activation-1', '2026-08-31T04:12:20Z', 'activation', 'success'),
      record('credit-1', '2026-08-31T04:12:30Z', 'credit', 'applied_test_balance')
    ]
  });

  assert.equal(result.state, 'HEALTHY');
  assert.equal(result.evidence.length, 4);
  for (const item of result.evidence) {
    assert.equal(item.provenance.status, 'Observed');
    assert.equal(item.provenance.authorization, 'AUTHORIZED_TEST_ACCOUNT');
    assert.ok(item.source);
    assert.ok(item.timestamp);
    assert.equal(item.geo, 'GB');
    assert.equal(item.authorizationEvidenceId, authEvidenceId);
  }
  assert.equal(result.savedGgr, null);
  assert.equal(result.savedRevenue, null);
  assert.equal(result.roiClaim, 'NOT_CLAIMED');
});

test('authorized integration uses the same provenance gate', () => {
  const integrationSubject = 'integration-1';
  const integrationAuthId = 'auth-integration-1';
  const result = classifyBonusFlow({
    authorization: 'AUTHORIZED_INTEGRATION',
    geo: 'DE',
    authorizationContext: {
      authorization: 'AUTHORIZED_INTEGRATION',
      subjectId: integrationSubject,
      evidence: {
        id: integrationAuthId,
        source: 'operator-integration-config',
        timestamp: '2026-08-31T04:13:00Z',
        geo: 'DE',
        subjectId: integrationSubject,
        authorization: 'AUTHORIZED_INTEGRATION',
        status: 'Observed'
      }
    },
    observationRecords: [
      {
        id: 'elig-i1', source: 'integration-fixture', timestamp: '2026-08-31T04:13:10Z', geo: 'DE',
        subjectId: integrationSubject, authorizationEvidenceId: integrationAuthId,
        observation: 'eligibility', value: 'eligible', status: 'Observed'
      },
      {
        id: 'offer-i1', source: 'integration-fixture', timestamp: '2026-08-31T04:13:20Z', geo: 'DE',
        subjectId: integrationSubject, authorizationEvidenceId: integrationAuthId,
        observation: 'offerVisible', value: true, status: 'Observed'
      },
      {
        id: 'activation-i1', source: 'integration-fixture', timestamp: '2026-08-31T04:13:30Z', geo: 'DE',
        subjectId: integrationSubject, authorizationEvidenceId: integrationAuthId,
        observation: 'activation', value: 'success', status: 'Observed'
      },
      {
        id: 'credit-i1', source: 'integration-fixture', timestamp: '2026-08-31T04:13:40Z', geo: 'DE',
        subjectId: integrationSubject, authorizationEvidenceId: integrationAuthId,
        observation: 'credit', value: 'applied_test_balance', status: 'Observed'
      }
    ]
  });

  assert.equal(result.state, 'HEALTHY');
  assert.equal(result.confidence, 'GUARDED');
  assert.ok(result.evidence.every((item) => item.provenance.authorization === 'AUTHORIZED_INTEGRATION'));
});
