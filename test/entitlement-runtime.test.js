import test from 'node:test';
import assert from 'node:assert/strict';
import { signCryptoWebhook } from '../src/crypto-confirmation.js';
import { buildFounderEntitlement, ensureDurableEntitlement } from '../src/entitlement.js';
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

function paymentResult(overrides = {}) {
  return {
    state: 'CONFIRMED',
    entitlementEligible: true,
    tenantId: 'tenant-a',
    invoiceId: 'inv-001',
    txHash: 'tx-001',
    asset: 'USDT_TRON',
    amount: '199.00',
    persistence: 'DURABLE_REDIS_REST',
    provenance: { status: 'Observed', source: 'SIGNED_PROVIDER_WEBHOOK' },
    ...overrides
  };
}

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

function signed(payload, timestamp = NOW) {
  const rawBody = JSON.stringify(payload);
  return {
    rawBody,
    headers: {
      'x-radar-timestamp': String(timestamp),
      'x-radar-signature': `sha256=${signCryptoWebhook(rawBody, { secret: SECRET, timestamp })}`
    }
  };
}

function recoverableRedisFetch() {
  const values = new Map();
  let failFirstEntitlement = true;
  return async (_url, options) => {
    const command = JSON.parse(options.body);
    const key = command[3];
    const fingerprint = command[4];
    if (key.includes(':entitlement:') && failFirstEntitlement) {
      failFirstEntitlement = false;
      return { ok: false, async json() { return {}; } };
    }
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

test('Founder entitlement requires durable trusted confirmed payment evidence', () => {
  const entitlement = buildFounderEntitlement(paymentResult());
  assert.equal(entitlement.state, 'ACTIVE');
  assert.equal(entitlement.plan, 'FOUNDER_EARLY_ACCESS');
  assert.equal(entitlement.brandLimit, 1);
  assert.equal(entitlement.priceUsd, '199.00');
  assert.equal(entitlement.savedGgr, null);
  assert.equal(entitlement.savedRevenue, null);
  assert.equal(entitlement.roiClaim, 'NOT_CLAIMED');

  assert.throws(() => buildFounderEntitlement(paymentResult({ persistence: 'PROCESS_LOCAL' })), /DURABLE_PAYMENT_REQUIRED/);
  assert.throws(() => buildFounderEntitlement(paymentResult({ provenance: { status: 'Inferred', source: 'SIGNED_PROVIDER_WEBHOOK' } })), /TRUSTED_PAYMENT_PROVENANCE_REQUIRED/);
  assert.throws(() => buildFounderEntitlement(paymentResult({ state: 'PENDING' })), /PAYMENT_NOT_CONFIRMED/);
});

test('entitlement materialization is idempotent and conflicts fail closed', async () => {
  const claims = new Map();
  const store = {
    persistence: 'DURABLE_REDIS_REST',
    async claimEntitlement(key, fingerprint) {
      const existing = claims.get(key);
      if (existing === undefined) {
        claims.set(key, fingerprint);
        return 'NEW';
      }
      return existing === fingerprint ? 'DUPLICATE' : 'CONFLICT';
    }
  };

  const first = await ensureDurableEntitlement(paymentResult(), { entitlementStore: store });
  const duplicate = await ensureDurableEntitlement(paymentResult({ state: 'DUPLICATE_PAYMENT_ACCEPTED', entitlementEligible: false }), { entitlementStore: store });
  assert.equal(first.materialization, 'NEW');
  assert.equal(duplicate.materialization, 'DUPLICATE');
  assert.equal(first.entitlementId, duplicate.entitlementId);

  await assert.rejects(() => ensureDurableEntitlement(paymentResult({ state: 'DUPLICATE_PAYMENT_ACCEPTED', entitlementEligible: false }), {
    entitlementStore: store,
    priceUsd: '299.00'
  }), /ENTITLEMENT_IDENTITY_CONFLICT/);
});

test('webhook retry can recover entitlement after payment claim succeeded but first entitlement write failed', async () => {
  const fetchImpl = recoverableRedisFetch();
  const first = await processCryptoWebhook({ ...signed(event({ eventId: 'evt-001' })), env: ENV, fetchImpl, now: NOW });
  assert.equal(first.statusCode, 503);
  assert.equal(first.body.error, 'crypto_confirmation_unavailable');

  const retry = await processCryptoWebhook({ ...signed(event({ eventId: 'evt-002' })), env: ENV, fetchImpl, now: NOW });
  assert.equal(retry.statusCode, 200);
  assert.equal(retry.body.state, 'DUPLICATE_PAYMENT_ACCEPTED');
  assert.equal(retry.body.entitlementEligible, false);
  assert.equal(retry.body.entitlement.state, 'ACTIVE');
  assert.equal(retry.body.entitlement.materialization, 'NEW');
  assert.equal(retry.body.entitlement.persistence, 'DURABLE_REDIS_REST');
  assert.equal(retry.body.entitlement.savedGgr, null);
  assert.equal(retry.body.entitlement.savedRevenue, null);
  assert.equal(retry.body.entitlement.roiClaim, 'NOT_CLAIMED');
});

test('pending payment never materializes entitlement', async () => {
  const fetchImpl = recoverableRedisFetch();
  const result = await processCryptoWebhook({ ...signed(event({ status: 'PENDING', confirmations: 0 })), env: ENV, fetchImpl, now: NOW });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.state, 'PENDING');
  assert.equal(result.body.entitlement, null);
});
