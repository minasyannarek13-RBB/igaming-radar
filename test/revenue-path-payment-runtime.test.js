import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyPaymentFlow } from '../src/payment-flow.js';
import { paymentFlowFixtures } from './fixtures/revenue-path-payment.js';

for (const fixture of paymentFlowFixtures) {
  test(`payment runtime classification: ${fixture.id}`, () => {
    const result = classifyPaymentFlow(fixture);
    assert.equal(result.state, fixture.expected.state);
    assert.equal(result.pathStage, 'CASHIER_PAYMENT');
    assert.equal(result.geo, fixture.geo);
    assert.equal(result.cause, 'NOT_OBSERVABLE');
    assert.equal(result.dependency, null);
    assert.deepEqual(result.dependencyEdges, []);
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

test('payment runtime rejects unapproved/private flow execution', () => {
  assert.throws(
    () => classifyPaymentFlow({ authorization: 'REAL_MONEY', geo: 'DE', observations: { cashier: 'reachable' } }),
    /public or explicitly authorized sandbox evidence/
  );
});

test('visible PSP brand plus one failed redirect does not create attribution', () => {
  const result = classifyPaymentFlow({
    authorization: 'PUBLIC_OR_AUTHORIZED_SANDBOX',
    geo: 'DE',
    observations: { cashier: 'reachable', method: 'visible', brandLabel: 'ExamplePay', redirect: 'unreachable' }
  });
  assert.equal(result.state, 'NOT_OBSERVABLE');
  assert.equal(result.dependency, null);
  assert.equal(result.dependencyEdges.length, 0);
});

test('corroborated redirect failure is degradation, not PSP root-cause attribution', () => {
  const result = classifyPaymentFlow({
    authorization: 'AUTHORIZED_SANDBOX',
    geo: 'DE',
    observations: { cashier: 'reachable', method: 'visible', brandLabel: 'ExamplePay', redirect: 'unreachable', repeated: true }
  });
  assert.equal(result.state, 'DEGRADED');
  assert.equal(result.cause, 'NOT_OBSERVABLE');
  assert.equal(result.dependency, null);
});
