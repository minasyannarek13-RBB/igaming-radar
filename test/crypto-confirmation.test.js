import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MemoryIdempotencyStore,
  confirmCryptoPayment,
  signCryptoWebhook,
  verifyCryptoWebhook
} from '../src/crypto-confirmation.js';

const SECRET = 'radar-crypto-webhook-secret-32-bytes-minimum-0001';
const NOW = 1_800_000_000;
const EXPECTED = {
  tenantId: 'tenant-a',
  invoiceId: 'inv-001',
  asset: 'USDT_TRON',
  amount: '199.00'
};

function event(overrides = {}) {
  return {
    eventId: 'evt-001',
    tenantId: 'tenant-a',
    invoiceId: 'inv-001',
    asset: 'USDT_TRON',
    amount: '199.00',
    txHash: 'abc123',
    status: 'CONFIRMED',
    confirmations: 12,
    ...overrides
  };
}

function signedInput(payload = event(), timestamp = NOW) {
  const rawBody = JSON.stringify(payload);
  return {
    rawBody,
    timestamp,
    signature: `sha256=${signCryptoWebhook(rawBody, { secret: SECRET, timestamp })}`
  };
}

test('valid signed provider callback confirms only the expected tenant invoice', () => {
  const result = confirmCryptoPayment(signedInput(), {
    secret: SECRET,
    expectedPayment: EXPECTED,
    idempotencyStore: new MemoryIdempotencyStore(),
    now: NOW,
    minConfirmations: 3
  });
  assert.equal(result.state, 'CONFIRMED');
  assert.equal(result.entitlementEligible, true);
  assert.equal(result.paymentClaim, 'NEW');
  assert.equal(result.persistence, 'PROCESS_LOCAL');
  assert.equal(result.provenance.status, 'Observed');
  assert.equal(result.provenance.chainObservation, 'Not observable externally');
  assert.equal(result.savedGgr, null);
  assert.equal(result.savedRevenue, null);
});

test('tampered body is rejected even when attacker reuses a valid signature', () => {
  const original = signedInput();
  const tampered = { ...original, rawBody: JSON.stringify(event({ amount: '1.00' })) };
  assert.throws(() => verifyCryptoWebhook(tampered, { secret: SECRET, now: NOW }), /INVALID_WEBHOOK_SIGNATURE/);
});

test('stale signed callback is rejected to constrain replay window', () => {
  const input = signedInput(event(), NOW - 301);
  assert.throws(() => verifyCryptoWebhook(input, { secret: SECRET, now: NOW }), /STALE_WEBHOOK/);
});

test('wrong tenant cannot confirm another tenant invoice', () => {
  const input = signedInput(event({ tenantId: 'tenant-b' }));
  assert.throws(() => confirmCryptoPayment(input, {
    secret: SECRET,
    expectedPayment: EXPECTED,
    idempotencyStore: new MemoryIdempotencyStore(),
    now: NOW
  }), /PAYMENT_TENANTID_MISMATCH/);
});

test('wrong amount or asset cannot confirm entitlement', () => {
  for (const payload of [event({ amount: '198.99' }), event({ asset: 'BTC' })]) {
    assert.throws(() => confirmCryptoPayment(signedInput(payload), {
      secret: SECRET,
      expectedPayment: EXPECTED,
      idempotencyStore: new MemoryIdempotencyStore(),
      now: NOW
    }), /PAYMENT_(AMOUNT|ASSET)_MISMATCH/);
  }
});

test('same event and same payload is accepted idempotently but cannot grant twice', () => {
  const store = new MemoryIdempotencyStore();
  const input = signedInput();
  const first = confirmCryptoPayment(input, { secret: SECRET, expectedPayment: EXPECTED, idempotencyStore: store, now: NOW });
  const second = confirmCryptoPayment(input, { secret: SECRET, expectedPayment: EXPECTED, idempotencyStore: store, now: NOW });
  assert.equal(first.state, 'CONFIRMED');
  assert.equal(first.entitlementEligible, true);
  assert.equal(second.state, 'DUPLICATE_ACCEPTED');
  assert.equal(second.entitlementEligible, false);
});

test('same payment with distinct event id cannot grant entitlement twice', () => {
  const store = new MemoryIdempotencyStore();
  const first = confirmCryptoPayment(signedInput(event({ eventId: 'evt-001' })), {
    secret: SECRET,
    expectedPayment: EXPECTED,
    idempotencyStore: store,
    now: NOW
  });
  const second = confirmCryptoPayment(signedInput(event({ eventId: 'evt-002' })), {
    secret: SECRET,
    expectedPayment: EXPECTED,
    idempotencyStore: store,
    now: NOW
  });
  assert.equal(first.state, 'CONFIRMED');
  assert.equal(first.entitlementEligible, true);
  assert.equal(second.state, 'DUPLICATE_PAYMENT_ACCEPTED');
  assert.equal(second.paymentClaim, 'DUPLICATE');
  assert.equal(second.entitlementEligible, false);
});

test('conflicting tx hash for an already claimed invoice fails closed', () => {
  const store = new MemoryIdempotencyStore();
  confirmCryptoPayment(signedInput(event({ eventId: 'evt-001', txHash: 'tx-a' })), {
    secret: SECRET,
    expectedPayment: EXPECTED,
    idempotencyStore: store,
    now: NOW
  });
  assert.throws(() => confirmCryptoPayment(signedInput(event({ eventId: 'evt-002', txHash: 'tx-b' })), {
    secret: SECRET,
    expectedPayment: EXPECTED,
    idempotencyStore: store,
    now: NOW
  }), /PAYMENT_IDENTITY_CONFLICT/);
});

test('pending callback does not consume final invoice claim before confirmation', () => {
  const store = new MemoryIdempotencyStore();
  const pending = confirmCryptoPayment(signedInput(event({ eventId: 'evt-pending', status: 'PENDING', confirmations: 0 })), {
    secret: SECRET,
    expectedPayment: EXPECTED,
    idempotencyStore: store,
    now: NOW,
    minConfirmations: 3
  });
  const confirmed = confirmCryptoPayment(signedInput(event({ eventId: 'evt-confirmed', status: 'CONFIRMED', confirmations: 12 })), {
    secret: SECRET,
    expectedPayment: EXPECTED,
    idempotencyStore: store,
    now: NOW,
    minConfirmations: 3
  });
  assert.equal(pending.state, 'PENDING');
  assert.equal(pending.entitlementEligible, false);
  assert.equal(confirmed.state, 'CONFIRMED');
  assert.equal(confirmed.entitlementEligible, true);
});

test('same event id with different signed payload is rejected as replay conflict', () => {
  const store = new MemoryIdempotencyStore();
  confirmCryptoPayment(signedInput(), { secret: SECRET, expectedPayment: EXPECTED, idempotencyStore: store, now: NOW });
  const conflict = signedInput(event({ txHash: 'different-tx' }));
  assert.throws(() => confirmCryptoPayment(conflict, {
    secret: SECRET,
    expectedPayment: EXPECTED,
    idempotencyStore: store,
    now: NOW
  }), /WEBHOOK_EVENT_REPLAY_CONFLICT/);
});

test('provider status alone does not confirm before configured confirmation threshold', () => {
  const result = confirmCryptoPayment(signedInput(event({ confirmations: 1 })), {
    secret: SECRET,
    expectedPayment: EXPECTED,
    idempotencyStore: new MemoryIdempotencyStore(),
    now: NOW,
    minConfirmations: 3
  });
  assert.equal(result.state, 'PENDING');
  assert.equal(result.entitlementEligible, false);
});

test('non-confirmed provider state remains pending', () => {
  const result = confirmCryptoPayment(signedInput(event({ status: 'PENDING', confirmations: 12 })), {
    secret: SECRET,
    expectedPayment: EXPECTED,
    idempotencyStore: new MemoryIdempotencyStore(),
    now: NOW,
    minConfirmations: 3
  });
  assert.equal(result.state, 'PENDING');
  assert.equal(result.entitlementEligible, false);
});

test('production caller must supply atomic event and payment idempotency methods', () => {
  assert.throws(() => confirmCryptoPayment(signedInput(), {
    secret: SECRET,
    expectedPayment: EXPECTED,
    now: NOW
  }), /ATOMIC_IDEMPOTENCY_STORE_REQUIRED/);
  assert.throws(() => confirmCryptoPayment(signedInput(), {
    secret: SECRET,
    expectedPayment: EXPECTED,
    idempotencyStore: { claimEvent() {} },
    now: NOW
  }), /ATOMIC_IDEMPOTENCY_STORE_REQUIRED/);
});

test('fresh process-local store cannot prove restart/replica replay resistance', () => {
  const first = confirmCryptoPayment(signedInput(event({ eventId: 'evt-001' })), {
    secret: SECRET,
    expectedPayment: EXPECTED,
    idempotencyStore: new MemoryIdempotencyStore(),
    now: NOW
  });
  const replayOnFreshInstance = confirmCryptoPayment(signedInput(event({ eventId: 'evt-002' })), {
    secret: SECRET,
    expectedPayment: EXPECTED,
    idempotencyStore: new MemoryIdempotencyStore(),
    now: NOW
  });
  assert.equal(first.entitlementEligible, true);
  assert.equal(replayOnFreshInstance.entitlementEligible, true);
  assert.equal(replayOnFreshInstance.persistence, 'PROCESS_LOCAL');
});

test('weak webhook secret is rejected', () => {
  assert.throws(() => signCryptoWebhook('{}', { secret: 'short', timestamp: NOW }), /WEAK_WEBHOOK_SECRET/);
});
