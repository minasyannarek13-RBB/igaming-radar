import { createHash } from 'node:crypto';

const MAX_ASSETS = 5;
const MAX_MARKERS = 8;

function requireString(value, code) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(code);
  return value.trim();
}

function normalizeTarget(value) {
  const raw = requireString(value, 'TARGET_REQUIRED');
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('INVALID_TARGET_URL');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('INVALID_TARGET_SCHEME');
  parsed.hash = '';
  return parsed.toString();
}

function normalizeGeo(value) {
  if (value == null || value === '') return 'UNKNOWN';
  return requireString(value, 'INVALID_REQUESTED_GEO').toUpperCase();
}

function normalizeMarkerList(value, code) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > MAX_MARKERS) throw new Error(code);
  return value.map((item) => {
    const marker = requireString(item, code);
    if (marker.length > 256) throw new Error(code);
    return marker;
  });
}

function normalizeCriticalAssetUrls(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > MAX_ASSETS) throw new Error('INVALID_CRITICAL_ASSET_URLS');
  return value.map((item) => normalizeTarget(item));
}

function normalizeProbeConfig(value) {
  if (value == null) return {
    ctaMarkers: [],
    errorMarkers: [],
    challengeMarkers: [],
    criticalAssetUrls: [],
    ctaCritical: false
  };
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_PROBE_CONFIG');
  return {
    ctaMarkers: normalizeMarkerList(value.ctaMarkers, 'INVALID_CTA_MARKERS'),
    errorMarkers: normalizeMarkerList(value.errorMarkers, 'INVALID_ERROR_MARKERS'),
    challengeMarkers: normalizeMarkerList(value.challengeMarkers, 'INVALID_CHALLENGE_MARKERS'),
    criticalAssetUrls: normalizeCriticalAssetUrls(value.criticalAssetUrls),
    ctaCritical: value.ctaCritical === true
  };
}

function targetId(scopeId, target, requestedGeo) {
  return createHash('sha256').update(`${scopeId}\n${target}\n${requestedGeo}`).digest('hex');
}

export function normalizeDomainLandingTarget(input, { now = () => new Date() } = {}) {
  if (!input || typeof input !== 'object') throw new Error('TARGET_CONFIG_REQUIRED');
  const scopeId = requireString(input.scopeId, 'SCOPE_ID_REQUIRED');
  const target = normalizeTarget(input.target);
  const requestedGeo = normalizeGeo(input.requestedGeo ?? input.geo);
  const recoveryConfirmations = input.recoveryConfirmations == null ? 2 : Number(input.recoveryConfirmations);
  if (!Number.isInteger(recoveryConfirmations) || recoveryConfirmations < 1 || recoveryConfirmations > 10) {
    throw new Error('INVALID_RECOVERY_CONFIRMATIONS');
  }
  const observedAt = now().toISOString();
  return {
    id: targetId(scopeId, target, requestedGeo),
    scopeId,
    target,
    requestedGeo,
    enabled: input.enabled !== false,
    recoveryConfirmations,
    config: normalizeProbeConfig(input.config),
    updatedAt: observedAt,
    lastRunAt: input.lastRunAt ?? null,
    lastRunStatus: input.lastRunStatus ?? null
  };
}

export class RedisRestDomainLandingTargetStore {
  constructor({ url, token, fetchImpl = globalThis.fetch, key = 'radar:domain-landing:targets' } = {}) {
    this.url = requireString(url, 'REDIS_REST_URL_REQUIRED').replace(/\/$/, '');
    this.token = requireString(token, 'REDIS_REST_TOKEN_REQUIRED');
    if (typeof fetchImpl !== 'function') throw new Error('FETCH_REQUIRED');
    this.fetchImpl = fetchImpl;
    this.key = key;
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
    if (!response || response.ok !== true) throw new Error('TARGET_BACKEND_UNAVAILABLE');
    const body = await response.json();
    if (!body || body.error) throw new Error('TARGET_BACKEND_ERROR');
    return body.result;
  }

  async put(input, options = {}) {
    const record = normalizeDomainLandingTarget(input, options);
    await this.command(['HSET', this.key, record.id, JSON.stringify(record)]);
    return record;
  }

  async remove(id) {
    requireString(id, 'TARGET_ID_REQUIRED');
    return Number(await this.command(['HDEL', this.key, id])) > 0;
  }

  async list({ enabledOnly = false, limit = 100 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('INVALID_TARGET_LIMIT');
    const raw = await this.command(['HGETALL', this.key]);
    if (raw == null) return [];
    if (!Array.isArray(raw)) throw new Error('INVALID_TARGET_BACKEND_RESULT');
    const records = [];
    for (let i = 0; i < raw.length; i += 2) {
      try {
        const parsed = JSON.parse(raw[i + 1]);
        if (!parsed?.id || !parsed?.scopeId || !parsed?.target) throw new Error('invalid');
        if (!enabledOnly || parsed.enabled === true) records.push(parsed);
      } catch {
        throw new Error('INVALID_TARGET_RECORD');
      }
      if (records.length >= limit) break;
    }
    return records;
  }

  async markRun(id, { at, status }) {
    requireString(id, 'TARGET_ID_REQUIRED');
    requireString(at, 'RUN_AT_REQUIRED');
    if (!['SUCCESS', 'FAILED'].includes(status)) throw new Error('INVALID_RUN_STATUS');
    const raw = await this.command(['HGET', this.key, id]);
    if (raw == null) return null;
    let record;
    try {
      record = JSON.parse(raw);
    } catch {
      throw new Error('INVALID_TARGET_RECORD');
    }
    record.lastRunAt = at;
    record.lastRunStatus = status;
    record.updatedAt = at;
    await this.command(['HSET', this.key, id, JSON.stringify(record)]);
    return record;
  }
}
