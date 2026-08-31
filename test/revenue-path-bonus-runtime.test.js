import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyBonusFlow } from '../src/bonus-flow.js';

const authorizedBase = {
  authorization: 'AUTHORIZED_TEST_ACCOUNT',
  geo: 'GB',
  executionMode: 'READ_ONLY_OR_TEST'
};

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

test('marketing offer visibility alone cannot prove eligibility or health', () => {
  const result = classifyBonusFlow({
    ...authorizedBase,
    observations: {
      offerVisible: true,
      eligibility: 'NOT_OBSERVABLE'
    }
  });

  assert.equal(result.state, 'NOT_OBSERVABLE');
  assert.equal(result.dependency, null);
  assert.deepEqual(result.dependencyEdges, []);
  assert.equal(result.confidence, 'GUARDED');
});

test('one activation failure remains NOT_OBSERVABLE', () => {
  const result = classifyBonusFlow({
    ...authorizedBase,
    observations: {
      eligibility: 'eligible',
      offerVisible: true,
      activation: 'failed',
      repeated: false
    }
  });

  assert.equal(result.state, 'NOT_OBSERVABLE');
});

test('repeated activation failure on an explicitly eligible authorized test path is BROKEN without root-cause attribution', () => {
  const result = classifyBonusFlow({
    ...authorizedBase,
    observations: {
      eligibility: 'eligible',
      offerVisible: true,
      activation: 'failed',
      repeated: true
    }
  });

  assert.equal(result.state, 'BROKEN');
  assert.equal(result.cause, 'NOT_OBSERVABLE');
  assert.equal(result.dependency, null);
  assert.deepEqual(result.dependencyEdges, []);
});

test('configured expected offer repeatedly missing for eligible authorized account is DEGRADED', () => {
  const result = classifyBonusFlow({
    ...authorizedBase,
    config: { expectedOffer: true },
    observations: {
      eligibility: 'eligible',
      offerVisible: false,
      repeated: true
    }
  });

  assert.equal(result.state, 'DEGRADED');
  assert.equal(result.cause, 'NOT_OBSERVABLE');
});

test('successful visible activation with opaque credit state remains NOT_OBSERVABLE', () => {
  const result = classifyBonusFlow({
    ...authorizedBase,
    observations: {
      eligibility: 'eligible',
      offerVisible: true,
      activation: 'success',
      credit: 'NOT_OBSERVABLE'
    }
  });

  assert.equal(result.state, 'NOT_OBSERVABLE');
});

test('authorized test path is HEALTHY only when eligibility, offer, activation and test credit are observed', () => {
  const result = classifyBonusFlow({
    ...authorizedBase,
    observations: {
      eligibility: 'eligible',
      offerVisible: true,
      activation: 'success',
      credit: 'applied_test_balance'
    }
  });

  assert.equal(result.state, 'HEALTHY');
  assert.ok(result.evidence.length >= 4);
  for (const item of result.evidence) {
    assert.equal(item.provenance.status, 'Observed');
    assert.equal(item.provenance.authorization, 'AUTHORIZED_TEST_ACCOUNT');
  }
  assert.equal(result.savedGgr, null);
  assert.equal(result.savedRevenue, null);
  assert.equal(result.roiClaim, 'NOT_CLAIMED');
});

test('authorized integration uses the same guarded evidence contract', () => {
  const result = classifyBonusFlow({
    authorization: 'AUTHORIZED_INTEGRATION',
    geo: 'DE',
    observations: {
      eligibility: 'eligible',
      offerVisible: true,
      activation: 'success',
      credit: 'applied_test_balance'
    }
  });

  assert.equal(result.state, 'HEALTHY');
  assert.equal(result.confidence, 'GUARDED');
  assert.ok(result.evidence.every((item) => item.provenance.authorization === 'AUTHORIZED_INTEGRATION'));
});
