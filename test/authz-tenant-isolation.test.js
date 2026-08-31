import test from 'node:test';
import assert from 'node:assert/strict';
import {
  signSessionToken,
  verifySessionToken,
  authorizeTenantResource,
  filterTenantResources
} from '../src/authz.js';

const SECRET = 'radar-test-secret-32-bytes-minimum-0001';
const NOW = 1_800_000_000;

function token(overrides = {}) {
  return signSessionToken({
    sub: 'user-1',
    tenantId: 'tenant-a',
    role: 'ADMIN',
    iat: NOW - 10,
    exp: NOW + 300,
    ...overrides
  }, { secret: SECRET });
}

test('verified signed session may access same-tenant resource', () => {
  const principal = verifySessionToken(token(), { secret: SECRET, now: NOW });
  assert.equal(authorizeTenantResource(principal, { tenantId: 'tenant-a', id: 'brand-a' }).allowed, true);
  assert.equal(principal.provenance.status, 'Observed');
});

test('cross-tenant read is denied even with valid ADMIN session', () => {
  const principal = verifySessionToken(token(), { secret: SECRET, now: NOW });
  assert.deepEqual(
    authorizeTenantResource(principal, { tenantId: 'tenant-b', id: 'brand-b' }),
    { allowed: false, reason: 'TENANT_MISMATCH' }
  );
});

test('tenant filtering cannot leak another tenant records', () => {
  const principal = verifySessionToken(token(), { secret: SECRET, now: NOW });
  const visible = filterTenantResources(principal, [
    { tenantId: 'tenant-a', id: 'a1' },
    { tenantId: 'tenant-b', id: 'b1' },
    { id: 'unscoped' }
  ]);
  assert.deepEqual(visible.map((r) => r.id), ['a1']);
});

test('tampered tenant claim invalidates token signature', () => {
  const original = token();
  const [header, payload, signature] = original.split('.');
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  claims.tenantId = 'tenant-b';
  const forgedPayload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  assert.throws(
    () => verifySessionToken(`${header}.${forgedPayload}.${signature}`, { secret: SECRET, now: NOW }),
    /INVALID_SIGNATURE/
  );
});

test('expired session is denied', () => {
  const expired = token({ iat: NOW - 500, exp: NOW - 100 });
  assert.throws(() => verifySessionToken(expired, { secret: SECRET, now: NOW }), /SESSION_EXPIRED/);
});

test('future-issued token outside skew is denied', () => {
  const future = token({ iat: NOW + 120, exp: NOW + 300 });
  assert.throws(() => verifySessionToken(future, { secret: SECRET, now: NOW }), /TOKEN_FROM_FUTURE/);
});

test('VIEWER cannot mutate tenant configuration', () => {
  const principal = verifySessionToken(token({ role: 'VIEWER' }), { secret: SECRET, now: NOW });
  assert.deepEqual(
    authorizeTenantResource(principal, { tenantId: 'tenant-a' }, 'CONFIG_WRITE'),
    { allowed: false, reason: 'INSUFFICIENT_ROLE' }
  );
});

test('unverified caller-supplied principal is denied', () => {
  assert.deepEqual(
    authorizeTenantResource({ tenantId: 'tenant-a', role: 'OWNER' }, { tenantId: 'tenant-a' }),
    { allowed: false, reason: 'UNVERIFIED_PRINCIPAL' }
  );
});

test('weak signing secret is rejected', () => {
  assert.throws(() => signSessionToken({ sub: 'u', tenantId: 't', role: 'OWNER' }, { secret: 'short' }), /WEAK_AUTH_SECRET/);
});
