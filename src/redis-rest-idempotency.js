import { createHash } from 'node:crypto';

const CLAIM_SCRIPT = `
local existing = redis.call('GET', KEYS[1])
if not existing then
  if ARGV[2] == '0' then
    redis.call('SET', KEYS[1], ARGV[1])
  else
    redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
  end
  return 'NEW'
end
if existing == ARGV[1] then
  return 'DUPLICATE'
end
return 'CONFLICT'
`;

function requireString(value, code) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(code);
}

function keyPart(value) {
  return createHash('sha256').update(value).digest('hex');
}

export class RedisRestIdempotencyStore {
  constructor({ url, token, fetchImpl = globalThis.fetch, prefix = 'radar:crypto', eventTtlSeconds = 86400 } = {}) {
    requireString(url, 'REDIS_REST_URL_REQUIRED');
    requireString(token, 'REDIS_REST_TOKEN_REQUIRED');
    if (typeof fetchImpl !== 'function') throw new Error('FETCH_REQUIRED');
    if (!Number.isInteger(eventTtlSeconds) || eventTtlSeconds < 300) throw new Error('INVALID_EVENT_TTL');
    this.url = url.replace(/\/$/, '');
    this.token = token;
    this.fetchImpl = fetchImpl;
    this.prefix = prefix;
    this.eventTtlSeconds = eventTtlSeconds;
    this.persistence = 'DURABLE_REDIS_REST';
  }

  async command(args) {
    const response = await this.fetchImpl(this.url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify(args)
    });
    if (!response || response.ok !== true) throw new Error('IDEMPOTENCY_BACKEND_UNAVAILABLE');
    const body = await response.json();
    if (!body || body.error) throw new Error('IDEMPOTENCY_BACKEND_ERROR');
    return body.result;
  }

  async claimKey(key, fingerprint, ttlSeconds) {
    requireString(key, 'IDEMPOTENCY_KEY_REQUIRED');
    requireString(fingerprint, 'IDEMPOTENCY_FINGERPRINT_REQUIRED');
    const result = await this.command(['EVAL', CLAIM_SCRIPT, '1', key, fingerprint, String(ttlSeconds)]);
    if (!['NEW', 'DUPLICATE', 'CONFLICT'].includes(result)) throw new Error('INVALID_IDEMPOTENCY_BACKEND_RESULT');
    return result;
  }

  claimEvent(eventId, fingerprint) {
    return this.claimKey(`${this.prefix}:event:${keyPart(eventId)}`, fingerprint, this.eventTtlSeconds);
  }

  claimPayment(key, fingerprint) {
    return this.claimKey(`${this.prefix}:payment:${keyPart(key)}`, fingerprint, 0);
  }

  claimEntitlement(key, fingerprint) {
    return this.claimKey(`${this.prefix}:entitlement:${keyPart(key)}`, fingerprint, 0);
  }
}
