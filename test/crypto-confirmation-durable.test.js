import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmCryptoPaymentDurable, MemoryIdempotencyStore, signCryptoWebhook } from '../src/crypto-confirmation.js';
import { RedisRestIdempotencyStore } from '../src/redis-rest-idempotency.js';

const SECRET = 'radar-crypto-webhook-secret-32-bytes-minimum-0001';
const NOW = 1_800_000_000;
const EXPECTED = { tenantId: 'tenant-a', invoiceId: 'inv-001', asset: 'USDT_TRON', amount: '199.00' };

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

function sharedRedisFetch() {
  const values = new Map();
  return async (_url, options) => {
    const command = JSON.parse(options.body);
    assert.equal(command[0], 'EVAL');
    const key = command[3];
    const fingerprint = command[4];
    const existing = values.get(key);
    let result;
    if (existing === undefined) {
      values.set(key, fingerprint);
      result = 'NEW';
    } else if (existing === fingerprint) {
      result = 'DUPLICATE';
    } else {
      result = 'CONFLICT';
    }
    return { ok: true, async json() { return { result }; } };
  };
}

function durableStore(fetchImpl) {
  return new RedisRestIdempotencyStore({
    url: 'https://redis.example.test',
    token: 'test-token',
    fetchImpl,
    prefix: 'test:radar'
  });
}

test('durable path rejects process-local idempotency', async () => {
  await assert.rejects(() => confirmCryptoPaymentDurable(signedInput(), {
    secret: SECRET,
    expectedPayment: EXPECTED,
    idempotencyStore: new MemoryIdempotencyStore(),
    now: NOW
  }), /DURABLE_ATOMIC_IDEMPOTENCY_STORE_REQUIRED/);
});

test('same payment cannot grant entitlement twice across fresh durable store instances', async () => {
  const fetchImpl = sharedRedisFetch();
  const first = await confirmCryptoPaymentDurable(signedInput(event({ eventId: 'evt-001' })), {
    secret: SECRET,
    expectedPayment: EXPECTED,
    idempotencyStore: durableStore(fetchImpl),
    now: NOW
  });
  const replay = await confirmCryptoPaymentDurable(signedInput(event({ eventId: 'evt-002' })), {
    secret: SECRET,
    expectedPayment: EXPECTED,
    idempotencyStore: durableStore(fetchImpl),
    now: NOW
  });
  assert.equal(first.state, 'CONFIRMED');
  assert.equal(first.entitlementEligible, true);
  assert.equal(first.persistence, 'DURABLE_REDIS_REST');
  assert.equal(replay.state, 'DUPLICATE_PAYMENT_ACCEPTED');
  assert.equal(replay.entitlementEligible, false);
  assert.equal(replay.persistence, 'DURABLE_REDIS_REST');
});

test('conflicting transaction for same invoice fails closed across fresh durable instances', async () => {
  const fetchImpl = sharedRedisFetch();
  await confirmCryptoPaymentDurable(signedInput(event({ eventId: 'evt-001', txHash: 'tx-a' })), {
    secret: SECRET,
    expectedPayment: EXPECTED,
    idempotencyStore: durableStore(fetchImpl),
    now: NOW
  });
  await assert.rejects(() => confirmCryptoPaymentDurable(signedInput(event({ eventId: 'evt-002', txHash: 'tx-b' })), {
    secret: SECRET,
    expectedPayment: EXPECTED,
    idempotencyStore: durableStore(fetchImpl),
    now: NOW
  }), /PAYMENT_IDENTITY_CONFLICT/);
});

test('durable adapter fails closed when persistence backend is unavailable', async () => {
  const store = durableStore(async () => ({ ok: false, async json() { return {}; } }));
  await assert.rejects(() => confirmCryptoPaymentDurable(signedInput(), {
    secret: SECRET,
    expectedPayment: EXPECTED,
    idempotencyStore: store,
    now: NOW
  }), /IDEMPOTENCY_BACKEND_UNAVAILABLE/);
});
