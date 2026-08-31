import { createHmac, timingSafeEqual, createHash } from 'node:crypto';

const DEFAULT_TOLERANCE_SECONDS = 300;
const MIN_SECRET_LENGTH = 32;

function requireSecret(secret) {
  if (typeof secret !== 'string' || secret.length < MIN_SECRET_LENGTH) {
    throw new Error('WEAK_WEBHOOK_SECRET');
  }
}

function requireRawBody(rawBody) {
  if (typeof rawBody !== 'string' || rawBody.length === 0) {
    throw new Error('RAW_BODY_REQUIRED');
  }
}

function normalizeSignature(signature) {
  if (typeof signature !== 'string' || signature.length === 0) throw new Error('SIGNATURE_REQUIRED');
  return signature.startsWith('sha256=') ? signature.slice(7) : signature;
}

function safeHexEqual(a, b) {
  if (!/^[a-f0-9]{64}$/i.test(a) || !/^[a-f0-9]{64}$/i.test(b)) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

function assertTimestamp(timestamp, now, toleranceSeconds) {
  const ts = Number(timestamp);
  if (!Number.isInteger(ts) || ts <= 0) throw new Error('INVALID_WEBHOOK_TIMESTAMP');
  if (Math.abs(now - ts) > toleranceSeconds) throw new Error('STALE_WEBHOOK');
  return ts;
}

function assertExpectedPayment(event, expected) {
  if (!expected || typeof expected !== 'object') throw new Error('EXPECTED_PAYMENT_REQUIRED');
  const required = ['tenantId', 'invoiceId', 'asset', 'amount'];
  for (const key of required) {
    if (typeof expected[key] !== 'string' || expected[key].length === 0) throw new Error(`EXPECTED_${key.toUpperCase()}_REQUIRED`);
    if (event[key] !== expected[key]) throw new Error(`PAYMENT_${key.toUpperCase()}_MISMATCH`);
  }
}

function assertEventShape(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Error('INVALID_WEBHOOK_EVENT');
  const required = ['eventId', 'tenantId', 'invoiceId', 'asset', 'amount', 'txHash', 'status'];
  for (const key of required) {
    if (typeof event[key] !== 'string' || event[key].length === 0) throw new Error(`EVENT_${key.toUpperCase()}_REQUIRED`);
  }
  if (!Number.isInteger(event.confirmations) || event.confirmations < 0) throw new Error('INVALID_CONFIRMATIONS');
}

function paymentKey(event) {
  return `${event.tenantId}\u0000${event.invoiceId}`;
}

function paymentFingerprint(event) {
  return createHash('sha256')
    .update(JSON.stringify({
      tenantId: event.tenantId,
      invoiceId: event.invoiceId,
      asset: event.asset,
      amount: event.amount,
      txHash: event.txHash
    }))
    .digest('hex');
}

export function signCryptoWebhook(rawBody, { secret, timestamp }) {
  requireSecret(secret);
  requireRawBody(rawBody);
  if (!Number.isInteger(timestamp) || timestamp <= 0) throw new Error('INVALID_WEBHOOK_TIMESTAMP');
  return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

export function verifyCryptoWebhook({ rawBody, signature, timestamp }, {
  secret,
  now = Math.floor(Date.now() / 1000),
  toleranceSeconds = DEFAULT_TOLERANCE_SECONDS
} = {}) {
  requireSecret(secret);
  requireRawBody(rawBody);
  if (!Number.isInteger(now) || now <= 0) throw new Error('INVALID_NOW');
  if (!Number.isInteger(toleranceSeconds) || toleranceSeconds <= 0) throw new Error('INVALID_TOLERANCE');
  const ts = assertTimestamp(timestamp, now, toleranceSeconds);
  const provided = normalizeSignature(signature);
  const expected = signCryptoWebhook(rawBody, { secret, timestamp: ts });
  if (!safeHexEqual(provided, expected)) throw new Error('INVALID_WEBHOOK_SIGNATURE');

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    throw new Error('INVALID_WEBHOOK_JSON');
  }
  assertEventShape(event);
  return event;
}

export class MemoryIdempotencyStore {
  constructor() {
    this.events = new Map();
    this.payments = new Map();
    this.persistence = 'PROCESS_LOCAL';
  }

  claimEvent(eventId, fingerprint) {
    const existing = this.events.get(eventId);
    if (!existing) {
      this.events.set(eventId, fingerprint);
      return 'NEW';
    }
    return existing === fingerprint ? 'DUPLICATE' : 'CONFLICT';
  }

  claimPayment(key, fingerprint) {
    const existing = this.payments.get(key);
    if (!existing) {
      this.payments.set(key, fingerprint);
      return 'NEW';
    }
    return existing === fingerprint ? 'DUPLICATE' : 'CONFLICT';
  }

  claim(eventId, fingerprint) {
    return this.claimEvent(eventId, fingerprint);
  }
}

export function confirmCryptoPayment(input, {
  secret,
  expectedPayment,
  idempotencyStore,
  now = Math.floor(Date.now() / 1000),
  toleranceSeconds = DEFAULT_TOLERANCE_SECONDS,
  minConfirmations = 1
} = {}) {
  if (!idempotencyStore || typeof idempotencyStore.claimEvent !== 'function' || typeof idempotencyStore.claimPayment !== 'function') {
    throw new Error('ATOMIC_IDEMPOTENCY_STORE_REQUIRED');
  }
  if (!Number.isInteger(minConfirmations) || minConfirmations < 1) throw new Error('INVALID_MIN_CONFIRMATIONS');

  const event = verifyCryptoWebhook(input, { secret, now, toleranceSeconds });
  assertExpectedPayment(event, expectedPayment);

  const eventFingerprint = createHash('sha256').update(input.rawBody).digest('hex');
  const eventClaim = idempotencyStore.claimEvent(event.eventId, eventFingerprint);
  if (eventClaim === 'CONFLICT') throw new Error('WEBHOOK_EVENT_REPLAY_CONFLICT');

  const base = {
    eventId: event.eventId,
    tenantId: event.tenantId,
    invoiceId: event.invoiceId,
    txHash: event.txHash,
    asset: event.asset,
    amount: event.amount,
    confirmations: event.confirmations,
    idempotency: eventClaim,
    paymentClaim: null,
    persistence: idempotencyStore.persistence ?? 'UNKNOWN',
    provenance: {
      status: 'Observed',
      source: 'SIGNED_PROVIDER_WEBHOOK',
      chainObservation: 'Not observable externally'
    },
    savedGgr: null,
    savedRevenue: null,
    roiClaim: 'NOT_CLAIMED'
  };

  if (eventClaim === 'DUPLICATE') return { ...base, state: 'DUPLICATE_ACCEPTED', entitlementEligible: false };
  if (event.status !== 'CONFIRMED') return { ...base, state: 'PENDING', entitlementEligible: false };
  if (event.confirmations < minConfirmations) return { ...base, state: 'PENDING', entitlementEligible: false };

  const finalClaim = idempotencyStore.claimPayment(paymentKey(event), paymentFingerprint(event));
  if (finalClaim === 'CONFLICT') throw new Error('PAYMENT_IDENTITY_CONFLICT');
  if (finalClaim === 'DUPLICATE') {
    return {
      ...base,
      paymentClaim: finalClaim,
      state: 'DUPLICATE_PAYMENT_ACCEPTED',
      entitlementEligible: false
    };
  }

  return {
    ...base,
    paymentClaim: finalClaim,
    state: 'CONFIRMED',
    entitlementEligible: true
  };
}
