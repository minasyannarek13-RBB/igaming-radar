import { createHash } from 'node:crypto';

const ELIGIBLE_PAYMENT_STATES = new Set(['CONFIRMED', 'DUPLICATE_PAYMENT_ACCEPTED']);

function requireString(value, code) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(code);
}

function stableFingerprint(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function buildFounderEntitlement(paymentResult, {
  plan = 'FOUNDER_EARLY_ACCESS',
  priceUsd = '199.00',
  brandLimit = 1
} = {}) {
  if (!paymentResult || typeof paymentResult !== 'object') throw new Error('PAYMENT_RESULT_REQUIRED');
  if (!ELIGIBLE_PAYMENT_STATES.has(paymentResult.state)) throw new Error('PAYMENT_NOT_CONFIRMED');
  if (paymentResult.persistence !== 'DURABLE_REDIS_REST') throw new Error('DURABLE_PAYMENT_REQUIRED');
  if (paymentResult.provenance?.status !== 'Observed' || paymentResult.provenance?.source !== 'SIGNED_PROVIDER_WEBHOOK') {
    throw new Error('TRUSTED_PAYMENT_PROVENANCE_REQUIRED');
  }
  for (const key of ['tenantId', 'invoiceId', 'txHash', 'asset', 'amount']) {
    requireString(paymentResult[key], `PAYMENT_${key.toUpperCase()}_REQUIRED`);
  }
  requireString(plan, 'ENTITLEMENT_PLAN_REQUIRED');
  requireString(priceUsd, 'ENTITLEMENT_PRICE_REQUIRED');
  if (!Number.isInteger(brandLimit) || brandLimit !== 1) throw new Error('FOUNDER_BRAND_LIMIT_MUST_BE_ONE');

  return Object.freeze({
    entitlementId: `crypto:${paymentResult.invoiceId}`,
    tenantId: paymentResult.tenantId,
    plan,
    state: 'ACTIVE',
    brandLimit,
    priceUsd,
    sourcePayment: Object.freeze({
      invoiceId: paymentResult.invoiceId,
      txHash: paymentResult.txHash,
      asset: paymentResult.asset,
      amount: paymentResult.amount
    }),
    provenance: Object.freeze({
      status: 'Observed',
      source: 'SIGNED_PROVIDER_WEBHOOK',
      persistence: paymentResult.persistence
    }),
    savedGgr: null,
    savedRevenue: null,
    roiClaim: 'NOT_CLAIMED'
  });
}

export async function ensureDurableEntitlement(paymentResult, {
  entitlementStore,
  plan,
  priceUsd,
  brandLimit
} = {}) {
  if (!entitlementStore || entitlementStore.persistence === 'PROCESS_LOCAL' || typeof entitlementStore.claimEntitlement !== 'function') {
    throw new Error('DURABLE_ENTITLEMENT_STORE_REQUIRED');
  }

  const entitlement = buildFounderEntitlement(paymentResult, { plan, priceUsd, brandLimit });
  const identity = `${entitlement.tenantId}\u0000${entitlement.entitlementId}`;
  const fingerprint = stableFingerprint({
    tenantId: entitlement.tenantId,
    entitlementId: entitlement.entitlementId,
    plan: entitlement.plan,
    brandLimit: entitlement.brandLimit,
    priceUsd: entitlement.priceUsd,
    sourcePayment: entitlement.sourcePayment
  });
  const claim = await entitlementStore.claimEntitlement(identity, fingerprint);
  if (claim === 'CONFLICT') throw new Error('ENTITLEMENT_IDENTITY_CONFLICT');
  if (!['NEW', 'DUPLICATE'].includes(claim)) throw new Error('INVALID_ENTITLEMENT_STORE_RESULT');

  return Object.freeze({
    ...entitlement,
    materialization: claim,
    persistence: entitlementStore.persistence
  });
}
