import crypto from 'node:crypto';

const ALLOWED_ROLES = new Set(['OWNER', 'ADMIN', 'ANALYST', 'VIEWER']);
const MUTATING_ACTIONS = new Set(['CONFIG_WRITE', 'ALERT_WRITE', 'ENTITLEMENT_WRITE']);

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

function parseJsonPart(part, label) {
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  } catch {
    throw new Error(`INVALID_${label}`);
  }
}

function assertString(value, code) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(code);
}

export function signSessionToken(claims, { secret, issuer = 'igaming-radar', audience = 'radar-app' }) {
  assertString(secret, 'MISSING_AUTH_SECRET');
  if (Buffer.byteLength(secret) < 32) throw new Error('WEAK_AUTH_SECRET');

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: issuer,
    aud: audience,
    iat: claims.iat ?? now,
    exp: claims.exp ?? now + 3600,
    sub: claims.sub,
    tenantId: claims.tenantId,
    role: claims.role
  };

  assertString(payload.sub, 'INVALID_SUBJECT');
  assertString(payload.tenantId, 'INVALID_TENANT');
  if (!ALLOWED_ROLES.has(payload.role)) throw new Error('INVALID_ROLE');

  const header = { alg: 'HS256', typ: 'JWT' };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = crypto.createHmac('sha256', secret).update(signingInput).digest('base64url');
  return `${signingInput}.${signature}`;
}

export function verifySessionToken(token, {
  secret,
  issuer = 'igaming-radar',
  audience = 'radar-app',
  now = Math.floor(Date.now() / 1000),
  maxClockSkewSeconds = 30
}) {
  assertString(secret, 'MISSING_AUTH_SECRET');
  if (Buffer.byteLength(secret) < 32) throw new Error('WEAK_AUTH_SECRET');
  assertString(token, 'MISSING_SESSION_TOKEN');

  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('INVALID_SESSION_TOKEN');

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = parseJsonPart(encodedHeader, 'HEADER');
  const payload = parseJsonPart(encodedPayload, 'PAYLOAD');

  if (header.alg !== 'HS256' || header.typ !== 'JWT') throw new Error('UNSUPPORTED_TOKEN');

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest();
  let provided;
  try {
    provided = Buffer.from(encodedSignature, 'base64url');
  } catch {
    throw new Error('INVALID_SIGNATURE');
  }
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    throw new Error('INVALID_SIGNATURE');
  }

  if (payload.iss !== issuer) throw new Error('INVALID_ISSUER');
  if (payload.aud !== audience) throw new Error('INVALID_AUDIENCE');
  assertString(payload.sub, 'INVALID_SUBJECT');
  assertString(payload.tenantId, 'INVALID_TENANT');
  if (!ALLOWED_ROLES.has(payload.role)) throw new Error('INVALID_ROLE');
  if (!Number.isInteger(payload.iat) || !Number.isInteger(payload.exp)) throw new Error('INVALID_TOKEN_TIME');
  if (payload.iat > now + maxClockSkewSeconds) throw new Error('TOKEN_FROM_FUTURE');
  if (payload.exp <= now - maxClockSkewSeconds) throw new Error('SESSION_EXPIRED');
  if (payload.exp <= payload.iat) throw new Error('INVALID_TOKEN_TIME');

  return Object.freeze({
    subjectId: payload.sub,
    tenantId: payload.tenantId,
    role: payload.role,
    issuedAt: payload.iat,
    expiresAt: payload.exp,
    provenance: Object.freeze({ kind: 'SIGNED_SESSION', status: 'Observed' })
  });
}

export function authorizeTenantResource(principal, resource, action = 'READ') {
  if (!principal || principal.provenance?.kind !== 'SIGNED_SESSION' || principal.provenance?.status !== 'Observed') {
    return { allowed: false, reason: 'UNVERIFIED_PRINCIPAL' };
  }
  if (!resource || typeof resource.tenantId !== 'string' || resource.tenantId.length === 0) {
    return { allowed: false, reason: 'UNSCOPED_RESOURCE' };
  }
  if (principal.tenantId !== resource.tenantId) {
    return { allowed: false, reason: 'TENANT_MISMATCH' };
  }
  if (MUTATING_ACTIONS.has(action) && !['OWNER', 'ADMIN'].includes(principal.role)) {
    return { allowed: false, reason: 'INSUFFICIENT_ROLE' };
  }
  return { allowed: true, reason: 'TENANT_BOUND_SESSION' };
}

export function filterTenantResources(principal, resources) {
  if (!Array.isArray(resources)) return [];
  return resources.filter((resource) => authorizeTenantResource(principal, resource).allowed);
}
