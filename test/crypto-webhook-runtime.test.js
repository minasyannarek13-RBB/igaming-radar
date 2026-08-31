import test from 'node:test';
import assert from 'node:assert/strict';
import { signCryptoWebhook } from '../src/crypto-confirmation.js';
import { processCryptoWebhook } from '../src/crypto-webhook-runtime.js';

const NOW = 1_800_000_000;
const SECRET = 'radar-crypto-webhook-secret-32-bytes-minimum-0001';
const ENV = {
  RADAR_CRYPTO_WEBHOOK_SECRET: SECRET,
  RADAR_REDIS_REST_URL: 'https://redis.example.test',
  RADAR_REDIS_REST_TOKEN: 'test-token',
  RADAR_CRYPTO_EXPECTED_PAYMENTS_JSON: JSON.stringify([
    { tenantId: 'tenant-a', invoiceId: 'inv-001', asset: 'USDT_TRON', amount: '199.00' }
  ]),
  RADAR_CRYPTO_MIN_CONFIRMATIONS: '2'
};

function event(overrides = {}) {
  return {
    eventId: 'evt-001',
    tenantId: 'tenant-a',
    invoiceId: 'inv-001',
    asset: 'USDT_TRON',
    amount: '199.00',
    txHash: 'tx-001',
    status: 'CONFIRMED',
    confirmations: 12,
    ...overrides
  };
}

function signed(payload = event(), timestamp = NOW) {
  const rawBody = JSON.stringify(payload);
  return {
    rawBody,
    headers: {
      'x-radar-timestamp': String(timestamp),
      'x-radar-signature': `sha256=${signCryptoWebhook(rawBody, { secret: SECRET, timestamp })}`
    }
  };
}

function sharedRedisFetch() {
  const values = new Map();
  return async (_url, options) => {
    const command = JSON.parse(options.body);
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

test('production crypto runtime fails closed when durable configuration is missing', async () => {
  const input = signed();
  const result = await processCryptoWebhook({
    ...input,
    env: { RADAR_CRYPTO_WEBHOOK_SECRET: SECRET },
    fetchImpl: sharedRedisFetch(),
    now: NOW
  });
  assert.equal(result.statusCode, 503);
  assert.deepEqual(result.body, { error: 'crypto_confirmation_unavailable' });
});

test('invalid signature is rejected before expected-payment lookup', async () => {
  const payload = event({ invoiceId: 'unknown-invoice' });
  const input = signed(payload);
  input.headers['x-radar-signature'] = 'sha256=' + '0'.repeat(64);
  const result = await processCryptoWebhook({ ...input, env: ENV, fetchImpl: sharedRedisFetch(), now: NOW });
  assert.equal(result.statusCode, 401);
  assert.deepEqual(result.body, { error: 'webhook_not_authorized' });
});

test('signed but unregistered invoice cannot become entitlement eligible', async () => {
  const input = signed(event({ invoiceId: 'inv-unknown' }));
  const result = await processCryptoWebhook({ ...input, env: ENV, fetchImpl: sharedRedisFetch(), now: NOW });
  assert.equal(result.statusCode, 404);
  assert.deepEqual(result.body, { error: 'expected_payment_not_found' });
});

test('trusted registry amount mismatch fails closed without entitlement', async () => {
  const input = signed(event({ amount: '198.99' }));
  const result = await processCryptoWebhook({ ...input, env: ENV, fetchImpl: sharedRedisFetch(), now: NOW });
  assert.equal(result.statusCode, 400);
  assert.deepEqual(result.body, { error: 'invalid_payment_event' });
});

test('fresh runtime instances sharing durable Redis cannot grant the same invoice twice', async () => {
  const fetchImpl = sharedRedisFetch();
  const firstInput = signed(event({ eventId: 'evt-001' }));
  const first = await processCryptoWebhook({ ...firstInput, env: ENV, fetchImpl, now: NOW });
  const secondInput = signed(event({ eventId: 'evt-002' }));
  const second = await processCryptoWebhook({ ...secondInput, env: ENV, fetchImpl, now: NOW });

  assert.equal(first.statusCode, 200);
  assert.equal(first.body.state, 'CONFIRMED');
  assert.equal(first.body.entitlementEligible, true);
  assert.equal(first.body.persistence, 'DURABLE_REDIS_REST');
  assert.equal(first.body.savedGgr, null);
  assert.equal(first.body.savedRevenue, null);
  assert.equal(first.body.roiClaim, 'NOT_CLAIMED');

  assert.equal(second.statusCode, 200);
  assert.equal(second.body.state, 'DUPLICATE_PAYMENT_ACCEPTED');
  assert.equal(second.body.entitlementEligible, false);
  assert.equal(second.body.persistence, 'DURABLE_REDIS_REST');
});

test('persistence outage fails closed and never returns entitlement eligibility', async () => {
  const input = signed();
  const result = await processCryptoWebhook({
    ...input,
    env: ENV,
    fetchImpl: async () => ({ ok: false, async json() { return {}; } }),
    now: NOW
  });
  assert.equal(result.statusCode, 503);
  assert.deepEqual(result.body, { error: 'crypto_confirmation_unavailable' });
});
