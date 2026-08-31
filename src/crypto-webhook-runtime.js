import { confirmCryptoPaymentDurable } from './crypto-confirmation.js';
import { RedisRestIdempotencyStore } from './redis-rest-idempotency.js';

function requireEnv(env, key) {
  const value = env?.[key];
  if (typeof value !== 'string' || value.length === 0) throw new Error(`CONFIG_${key}_REQUIRED`);
  return value;
}

function loadExpectedPayments(env) {
  const raw = requireEnv(env, 'RADAR_CRYPTO_EXPECTED_PAYMENTS_JSON');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('CONFIG_EXPECTED_PAYMENTS_INVALID_JSON');
  }
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('CONFIG_EXPECTED_PAYMENTS_REQUIRED');

  const registry = new Map();
  for (const payment of parsed) {
    if (!payment || typeof payment !== 'object' || Array.isArray(payment)) throw new Error('CONFIG_EXPECTED_PAYMENT_INVALID');
    for (const key of ['tenantId', 'invoiceId', 'asset', 'amount']) {
      if (typeof payment[key] !== 'string' || payment[key].length === 0) throw new Error(`CONFIG_EXPECTED_${key.toUpperCase()}_REQUIRED`);
    }
    const key = `${payment.tenantId}\u0000${payment.invoiceId}`;
    if (registry.has(key)) throw new Error('CONFIG_EXPECTED_PAYMENT_DUPLICATE');
    registry.set(key, {
      tenantId: payment.tenantId,
      invoiceId: payment.invoiceId,
      asset: payment.asset,
      amount: payment.amount
    });
  }
  return registry;
}

function parseUnsignedEnvelope(rawBody) {
  if (typeof rawBody !== 'string' || rawBody.length === 0) throw new Error('RAW_BODY_REQUIRED');
  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    throw new Error('INVALID_WEBHOOK_JSON');
  }
  if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Error('INVALID_WEBHOOK_EVENT');
  if (typeof event.tenantId !== 'string' || typeof event.invoiceId !== 'string') throw new Error('INVALID_WEBHOOK_EVENT');
  return event;
}

function readHeader(headers, name) {
  if (!headers) return undefined;
  if (typeof headers.get === 'function') return headers.get(name) ?? undefined;
  const direct = headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];
  if (Array.isArray(direct)) return direct[0];
  return direct;
}

function mapError(error) {
  const code = error?.message || 'CRYPTO_CONFIRMATION_FAILED';
  if (code.startsWith('CONFIG_') || code === 'IDEMPOTENCY_BACKEND_UNAVAILABLE' || code === 'IDEMPOTENCY_BACKEND_ERROR') {
    return { statusCode: 503, body: { error: 'crypto_confirmation_unavailable' } };
  }
  if (code === 'INVALID_WEBHOOK_SIGNATURE' || code === 'SIGNATURE_REQUIRED' || code === 'STALE_WEBHOOK' || code === 'INVALID_WEBHOOK_TIMESTAMP') {
    return { statusCode: 401, body: { error: 'webhook_not_authorized' } };
  }
  if (code === 'WEBHOOK_EVENT_REPLAY_CONFLICT' || code === 'PAYMENT_IDENTITY_CONFLICT') {
    return { statusCode: 409, body: { error: 'payment_conflict' } };
  }
  if (code.startsWith('PAYMENT_') || code.startsWith('EVENT_') || code.startsWith('INVALID_') || code === 'RAW_BODY_REQUIRED') {
    return { statusCode: 400, body: { error: 'invalid_payment_event' } };
  }
  return { statusCode: 500, body: { error: 'crypto_confirmation_failed' } };
}

export async function processCryptoWebhook({ rawBody, headers, env = process.env, fetchImpl = globalThis.fetch, now } = {}) {
  try {
    const secret = requireEnv(env, 'RADAR_CRYPTO_WEBHOOK_SECRET');
    const redisUrl = requireEnv(env, 'RADAR_REDIS_REST_URL');
    const redisToken = requireEnv(env, 'RADAR_REDIS_REST_TOKEN');
    const registry = loadExpectedPayments(env);
    const unsigned = parseUnsignedEnvelope(rawBody);
    const expectedPayment = registry.get(`${unsigned.tenantId}\u0000${unsigned.invoiceId}`);
    if (!expectedPayment) return { statusCode: 404, body: { error: 'expected_payment_not_found' } };

    const timestampHeader = readHeader(headers, 'x-radar-timestamp');
    const signature = readHeader(headers, 'x-radar-signature');
    const timestamp = Number(timestampHeader);
    const minConfirmationsRaw = env.RADAR_CRYPTO_MIN_CONFIRMATIONS ?? '1';
    const minConfirmations = Number(minConfirmationsRaw);
    if (!Number.isInteger(minConfirmations) || minConfirmations < 1) throw new Error('CONFIG_MIN_CONFIRMATIONS_INVALID');

    const idempotencyStore = new RedisRestIdempotencyStore({
      url: redisUrl,
      token: redisToken,
      fetchImpl,
      prefix: 'radar:crypto'
    });

    const result = await confirmCryptoPaymentDurable({ rawBody, signature, timestamp }, {
      secret,
      expectedPayment,
      idempotencyStore,
      ...(Number.isInteger(now) ? { now } : {}),
      minConfirmations
    });

    return {
      statusCode: 200,
      body: {
        state: result.state,
        tenantId: result.tenantId,
        invoiceId: result.invoiceId,
        txHash: result.txHash,
        confirmations: result.confirmations,
        entitlementEligible: result.entitlementEligible,
        persistence: result.persistence,
        provenance: result.provenance,
        savedGgr: null,
        savedRevenue: null,
        roiClaim: 'NOT_CLAIMED'
      }
    };
  } catch (error) {
    return mapError(error);
  }
}
