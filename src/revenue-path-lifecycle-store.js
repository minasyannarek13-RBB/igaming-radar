import { createHash } from 'node:crypto';

const CAS_SCRIPT = `
local existing = redis.call('GET', KEYS[1])
local currentVersion = 0
if existing then
  local decoded = cjson.decode(existing)
  currentVersion = tonumber(decoded.version or 0)
end
if currentVersion ~= tonumber(ARGV[1]) then
  return 'CONFLICT'
end
redis.call('SET', KEYS[1], ARGV[2])
return 'STORED'
`;

function requireString(value, code) { if (typeof value !== 'string' || value.length === 0) throw new Error(code); }
function keyPart(value) { return createHash('sha256').update(value).digest('hex'); }

export class RedisRestRevenuePathStore {
  constructor({ url, token, fetchImpl = globalThis.fetch, prefix = 'radar:revenue-path' } = {}) {
    requireString(url, 'REDIS_REST_URL_REQUIRED'); requireString(token, 'REDIS_REST_TOKEN_REQUIRED');
    if (typeof fetchImpl !== 'function') throw new Error('FETCH_REQUIRED');
    this.url = url.replace(/\/$/, ''); this.token = token; this.fetchImpl = fetchImpl; this.prefix = prefix; this.persistence = 'DURABLE_REDIS_REST';
  }
  key(scopeId, target, geo) { requireString(scopeId, 'SCOPE_ID_REQUIRED'); requireString(target, 'TARGET_REQUIRED'); requireString(geo, 'GEO_REQUIRED'); return `${this.prefix}:${keyPart(scopeId)}:${keyPart(target)}:${keyPart(geo)}`; }
  observationKey(scopeId) { requireString(scopeId, 'SCOPE_ID_REQUIRED'); return `${this.prefix}:observations:${keyPart(scopeId)}`; }
  observationField(target, geo) { requireString(target, 'TARGET_REQUIRED'); requireString(geo, 'GEO_REQUIRED'); return `${keyPart(target)}:${keyPart(geo)}`; }
  async command(args) {
    const response = await this.fetchImpl(this.url, { method: 'POST', headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' }, body: JSON.stringify(args) });
    if (!response || response.ok !== true) throw new Error('REVENUE_PATH_BACKEND_UNAVAILABLE');
    const body = await response.json(); if (!body || body.error) throw new Error('REVENUE_PATH_BACKEND_ERROR'); return body.result;
  }
  async get(scopeId, target, geo) {
    const raw = await this.command(['GET', this.key(scopeId, target, geo)]); if (raw == null) return null;
    try { const parsed = JSON.parse(raw); if (!Number.isInteger(parsed.version) || parsed.version < 1 || !parsed.lifecycle) throw new Error('INVALID_REVENUE_PATH_RECORD'); return parsed; }
    catch (error) { if (error?.message === 'INVALID_REVENUE_PATH_RECORD') throw error; throw new Error('INVALID_REVENUE_PATH_RECORD'); }
  }
  async compareAndSet(scopeId, target, geo, expectedVersion, lifecycle) {
    if (!Number.isInteger(expectedVersion) || expectedVersion < 0) throw new Error('INVALID_EXPECTED_VERSION');
    const record = { version: expectedVersion + 1, lifecycle };
    const result = await this.command(['EVAL', CAS_SCRIPT, '1', this.key(scopeId, target, geo), String(expectedVersion), JSON.stringify(record)]);
    if (!['STORED', 'CONFLICT'].includes(result)) throw new Error('INVALID_REVENUE_PATH_BACKEND_RESULT');
    return result === 'STORED' ? record : null;
  }
  async recordObservation(observation) {
    const { scopeId, target, geo, state, observedAt, geoProvenance } = observation ?? {};
    requireString(scopeId, 'SCOPE_ID_REQUIRED'); requireString(target, 'TARGET_REQUIRED'); requireString(geo, 'GEO_REQUIRED'); requireString(state, 'STATE_REQUIRED'); requireString(observedAt, 'OBSERVED_AT_REQUIRED'); requireString(geoProvenance, 'GEO_PROVENANCE_REQUIRED');
    const failureSignature = typeof observation?.failureSignature === 'string' && observation.failureSignature.length <= 160 ? observation.failureSignature : null;
    const failureConfirmations = Number.isInteger(observation?.failureConfirmations) && observation.failureConfirmations >= 0 ? observation.failureConfirmations : 0;
    const record = { scopeId, target, geo, state, observedAt, geoProvenance, controlGroup: observation?.controlGroup ?? null, failureSignature, failureConfirmations };
    await this.command(['HSET', this.observationKey(scopeId), this.observationField(target, geo), JSON.stringify(record)]);
    return record;
  }
  async listObservations(scopeId) {
    const raw = await this.command(['HGETALL', this.observationKey(scopeId)]); if (raw == null) return [];
    if (!Array.isArray(raw)) throw new Error('INVALID_OBSERVATION_BACKEND_RESULT');
    const records = [];
    for (let i = 0; i < raw.length; i += 2) {
      try { const parsed = JSON.parse(raw[i + 1]); if (!parsed?.scopeId || !parsed?.target || !parsed?.geo || !parsed?.state || !parsed?.observedAt || !parsed?.geoProvenance) throw new Error('invalid'); records.push(parsed); }
      catch { throw new Error('INVALID_OBSERVATION_RECORD'); }
    }
    return records;
  }
}
