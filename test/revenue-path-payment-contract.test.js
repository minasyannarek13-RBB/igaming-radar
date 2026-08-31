import test from 'node:test';
import assert from 'node:assert/strict';
import { paymentFlowFixtures } from './fixtures/revenue-path-payment.js';

const STATES = new Set(['HEALTHY', 'DEGRADED', 'BROKEN', 'NOT_OBSERVABLE']);
const AUTH = new Set(['PUBLIC_OR_AUTHORIZED_SANDBOX', 'AUTHORIZED_SANDBOX']);

for (const fixture of paymentFlowFixtures) {
  test(`payment fixture contract: ${fixture.id}`, () => {
    assert.match(fixture.id, /^[a-z0-9-]+$/);
    assert.equal(fixture.pathStage, 'CASHIER_PAYMENT');
    assert.ok(AUTH.has(fixture.authorization));
    assert.ok(fixture.geo);
    assert.ok(fixture.observations && typeof fixture.observations === 'object');
    assert.ok(STATES.has(fixture.expected.state));
    assert.equal(fixture.expected.attributable, false, 'fixture must not infer PSP/root cause');
    assert.equal(fixture.expected.dependencyEdges, 0, 'fixture must not fabricate a PSP dependency edge');
    assert.equal(fixture.expected.cause, 'NOT_OBSERVABLE');
  });
}

test('Payment Flow fixture set covers sellable authorized observability boundary', () => {
  const required = [
    'cashier-method-healthy',
    'cashier-unreachable-corroborated',
    'payment-method-missing',
    'psp-redirect-unreachable',
    'iframe-unobservable',
    'callback-unobservable',
    'psp-brand-visible-no-attribution'
  ];
  assert.deepEqual(paymentFlowFixtures.map((f) => f.id).sort(), required.sort());
});

test('brand visibility alone cannot attribute a failing PSP', () => {
  const fixture = paymentFlowFixtures.find((f) => f.id === 'psp-brand-visible-no-attribution');
  assert.equal(fixture.expected.state, 'NOT_OBSERVABLE');
  assert.equal(fixture.expected.attributable, false);
  assert.equal(fixture.expected.dependencyEdges, 0);
});

test('return/callback is explicit NOT_OBSERVABLE when external evidence cannot verify it', () => {
  const fixture = paymentFlowFixtures.find((f) => f.id === 'callback-unobservable');
  assert.equal(fixture.observations.callback, 'NOT_OBSERVABLE');
  assert.equal(fixture.expected.state, 'NOT_OBSERVABLE');
});

test('fixtures contain no real-money or credential-bearing actions', () => {
  const serialized = JSON.stringify(paymentFlowFixtures).toLowerCase();
  for (const forbidden of ['real deposit', 'card number', 'cvv', 'password', 'bypass']) {
    assert.equal(serialized.includes(forbidden), false, `forbidden payment-test behavior: ${forbidden}`);
  }
});
