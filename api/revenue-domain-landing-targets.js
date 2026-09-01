import { timingSafeEqual } from 'node:crypto';
import { RedisRestDomainLandingTargetStore } from '../src/domain-landing-target-store.js';

const MAX_JSON_BYTES = 16_384;

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const raw = typeof req.body === 'string'
    ? req.body
    : await (async () => {
        let body = '';
        for await (const chunk of req) {
          body += chunk;
          if (Buffer.byteLength(body) > MAX_JSON_BYTES) {
            throw Object.assign(new Error('payload_too_large'), { statusCode: 413 });
          }
        }
        return body;
      })();
  if (Buffer.byteLength(raw) > MAX_JSON_BYTES) {
    throw Object.assign(new Error('payload_too_large'), { statusCode: 413 });
  }
  try {
    return JSON.parse(raw || '{}');
  } catch {
    throw Object.assign(new Error('invalid_json'), { statusCode: 400 });
  }
}

function authorize(req) {
  const expectedToken = process.env.RADAR_INTERNAL_TOKEN;
  const supplied = String(req.headers?.authorization || '').replace(/^Bearer\s+/i, '');
  return Boolean(expectedToken) && safeEqual(supplied, expectedToken);
}

function createStore() {
  return new RedisRestDomainLandingTargetStore({
    url: process.env.REDIS_REST_URL,
    token: process.env.REDIS_REST_TOKEN
  });
}

function publicRecord(record) {
  if (!record) return null;
  return {
    id: record.id,
    scopeId: record.scopeId,
    target: record.target,
    requestedGeo: record.requestedGeo,
    enabled: record.enabled,
    recoveryConfirmations: record.recoveryConfirmations,
    config: record.config,
    updatedAt: record.updatedAt,
    lastRunAt: record.lastRunAt,
    lastRunStatus: record.lastRunStatus
  };
}

export default async function handler(req, res) {
  if (!['GET', 'PUT', 'DELETE'].includes(req.method)) {
    res.setHeader('allow', 'GET, PUT, DELETE');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  if (!authorize(req)) return res.status(401).json({ error: 'unauthorized' });

  try {
    const store = createStore();

    if (req.method === 'GET') {
      const limitRaw = Array.isArray(req.query?.limit) ? req.query.limit[0] : req.query?.limit;
      const limit = limitRaw == null ? 100 : Number(limitRaw);
      const enabledRaw = Array.isArray(req.query?.enabledOnly) ? req.query.enabledOnly[0] : req.query?.enabledOnly;
      const enabledOnly = enabledRaw === '1' || enabledRaw === 'true';
      const records = await store.list({ enabledOnly, limit });
      return res.status(200).json({
        contract: 'domain-landing-target-config/v1',
        count: records.length,
        targets: records.map(publicRecord)
      });
    }

    const input = await readBody(req);
    if (req.method === 'PUT') {
      const record = await store.put(input);
      return res.status(200).json({
        contract: 'domain-landing-target-config/v1',
        action: 'UPSERTED',
        target: publicRecord(record)
      });
    }

    const id = typeof input.id === 'string' ? input.id.trim() : '';
    if (!id) return res.status(400).json({ error: 'TARGET_ID_REQUIRED' });
    const removed = await store.remove(id);
    return res.status(200).json({
      contract: 'domain-landing-target-config/v1',
      action: removed ? 'REMOVED' : 'NOT_FOUND',
      id
    });
  } catch (error) {
    const knownValidation = new Set([
      'TARGET_CONFIG_REQUIRED', 'SCOPE_ID_REQUIRED', 'TARGET_REQUIRED', 'INVALID_TARGET_URL',
      'INVALID_TARGET_SCHEME', 'INVALID_REQUESTED_GEO', 'INVALID_RECOVERY_CONFIRMATIONS',
      'INVALID_PROBE_CONFIG', 'INVALID_CTA_MARKERS', 'INVALID_ERROR_MARKERS',
      'INVALID_CHALLENGE_MARKERS', 'INVALID_CRITICAL_ASSET_URLS', 'INVALID_CONTROL_GROUP',
      'INVALID_TARGET_LIMIT', 'TARGET_ID_REQUIRED', 'payload_too_large', 'invalid_json'
    ]);
    const statusCode = Number(error?.statusCode) || (knownValidation.has(error?.message) ? 400 : 500);
    const safeError = statusCode >= 500 ? 'domain_landing_target_config_failed' : error.message;
    return res.status(statusCode).json({ error: safeError });
  }
}
