import { createHash } from 'node:crypto';

const OBSERVATION_HISTORY_LIMIT = 1000;

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

const CAS_WITH_OBSERVATION_SCRIPT = `
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
redis.call('HSET', KEYS[2], ARGV[3], ARGV[4])
redis.call('ZADD', KEYS[3], ARGV[5], ARGV[6])
local count = redis.call('ZCARD', KEYS[3])
local limit = tonumber(ARGV[7])
if count > limit then
  redis.call('ZREMRANGEBYRANK', KEYS[3], 0, count - limit - 1)
end
return 'STORED'
`;

const RECORD_OBSERVATION_SCRIPT = `
redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
redis.call('ZADD', KEYS[2], ARGV[3], ARGV[4])
local count = redis.call('ZCARD', KEYS[2])
local limit = tonumber(ARGV[5])
if count > limit then
  redis.call('ZREMRANGEBYRANK', KEYS[2], 0, count - limit - 1)
end
return 'STORED'
`;

function requireString(value, code) { if (typeof value !== 'string' || value.length === 0) throw new Error(code); }
function keyPart(value) { return createHash('sha256').update(value).digest('hex'); }

function normalizeObservation(observation) {
  const { scopeId, target, geo, state, observedAt, geoProvenance } = observation ?? {};
  requireString(scopeId, 'SCOPE_ID_REQUIRED'); requireString(target, 'TARGET_REQUIRED'); requireString(geo, 'GEO_REQUIRED'); requireString(state, 'STATE_REQUIRED'); requireString(observedAt, 'OBSERVED_AT_REQUIRED'); requireString(geoProvenance, 'GEO_PROVENANCE_REQUIRED');
  const observedAtMs = Date.parse(observedAt);
  if (!Number.isFinite(observedAtMs)) throw new Error('INVALID_OBSERVED_AT');
  const failureSignature = typeof observation?.failureSignature === 'string' && observation.failureSignature.length <= 160 ? observation.failureSignature : null;
  const failureConfirmations = Number.isInteger(observation?.failureConfirmations) && observation.failureConfirmations >= 0 ? observation.failureConfirmations : 0;
  return { scopeId, target, geo, state, observedAt, geoProvenance, controlGroup: observation?.controlGroup ?? null, failureSignature, failureConfirmations };
}

function observationHistoryMember(record) {
  const serialized = JSON.stringify(record);
  return `${record.observedAt}:${keyPart(serialized)}:${serialized}`;
}

function parseObservationHistoryMember(member) {
  if (typeof member !== 'string') throw new Error('INVALID_OBSERVATION_RECORD');
  const first = member.indexOf(':');
  const second = member.indexOf(':', first + 1);
  if (first < 0 || second < 0) throw new Error('INVALID_OBSERVATION_RECORD');
  return member.slice(second + 1);
}

function parseObservation(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed?.scopeId || !parsed?.target || !parsed?.geo || !parsed?.state || !parsed?.observedAt || !parsed?.geoProvenance) throw new Error('invalid');
    return parsed;
  } catch {
    throw new Error('INVALID_OBSERVATION_RECORD');
  }
}

export class RedisRestRevenuePathStore {
  constructor({ url, token, fetchImpl = globalThis.fetch, prefix = 'radar:revenue-path' } = {}) {
    requireString(url, 'REDIS_REST_URL_REQUIRED'); requireString(token, 'REDIS_REST_TOKEN_REQUIRED');
    if (typeof fetchImpl !== 'function') throw new Error('FETCH_REQUIRED');
    this.url = url.replace(/\/$/, ''); this.token = token; this.fetchImpl = fetchImpl; this.prefix = prefix; this.persistence = 'DURABLE_REDIS_REST';
  }
  key(scopeId, target, geo) { requireString(scopeId, 'SCOPE_ID_REQUIRED'); requireString(target, 'TARGET_REQUIRED'); requireString(geo, 'GEO_REQUIRED'); return `${this.prefix}:${keyPart(scopeId)}:${keyPart(target)}:${keyPart(geo)}`; }
  observationKey(scopeId) { requireString(scopeId, 'SCOPE_ID_REQUIRED'); return `${this.prefix}:observations:${keyPart(scopeId)}`; }
  observationHistoryKey(scopeId) { requireString(scopeId, 'SCOPE_ID_REQUIRED'); return `${this.prefix}:observation-history:${keyPart(scopeId)}`; }
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
  async compareAndSetWithObservation(scopeId, target, geo, expectedVersion, lifecycle, observation) {
    if (!Number.isInteger(expectedVersion) || expectedVersion < 0) throw new Error('INVALID_EXPECTED_VERSION');
    const normalized = normalizeObservation(observation);
    if (normalized.scopeId !== scopeId || normalized.target !== target || normalized.geo !== geo) throw new Error('OBSERVATION_KEY_MISMATCH');
    const record = { version: expectedVersion + 1, lifecycle };
    const serializedObservation = JSON.stringify(normalized);
    const result = await this.command(['EVAL', CAS_WITH_OBSERVATION_SCRIPT, '3', this.key(scopeId, target, geo), this.observationKey(scopeId), this.observationHistoryKey(scopeId), String(expectedVersion), JSON.stringify(record), this.observationField(target, geo), serializedObservation, String(Date.parse(normalized.observedAt)), observationHistoryMember(normalized), String(OBSERVATION_HISTORY_LIMIT)]);
    if (!['STORED', 'CONFLICT'].includes(result)) throw new Error('INVALID_REVENUE_PATH_BACKEND_RESULT');
    return result === 'STORED' ? { ...record, observation: normalized } : null;
  }
  async recordObservation(observation) {
    const record = normalizeObservation(observation);
    const serialized = JSON.stringify(record);
    const result = await this.command(['EVAL', RECORD_OBSERVATION_SCRIPT, '2', this.observationKey(record.scopeId), this.observationHistoryKey(record.scopeId), this.observationField(record.target, record.geo), serialized, String(Date.parse(record.observedAt)), observationHistoryMember(record), String(OBSERVATION_HISTORY_LIMIT)]);
    if (result !== 'STORED') throw new Error('INVALID_REVENUE_PATH_BACKEND_RESULT');
    return record;
  }
  async listObservations(scopeId) {
    const history = await this.command(['ZREVRANGE', this.observationHistoryKey(scopeId), '0', String(OBSERVATION_HISTORY_LIMIT - 1)]);
    if (history != null && (!Array.isArray(history) || history.length > 0)) {
      if (!Array.isArray(history)) throw new Error('INVALID_OBSERVATION_BACKEND_RESULT');
      return history.map((member) => parseObservation(parseObservationHistoryMember(member)));
    }

    const raw = await this.command(['HGETALL', this.observationKey(scopeId)]); if (raw == null) return [];
    if (!Array.isArray(raw)) throw new Error('INVALID_OBSERVATION_BACKEND_RESULT');
    const records = [];
    for (let i = 0; i < raw.length; i += 2) records.push(parseObservation(raw[i + 1]));
    return records.sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt));
  }
}
