import { timingSafeEqual } from 'node:crypto';
import { runDomainLandingCycle } from '../src/domain-landing-cycle.js';
import { RedisRestRevenuePathStore } from '../src/revenue-path-lifecycle-store.js';

const MAX_JSON_BYTES = 24_576;

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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const expectedToken = process.env.RADAR_INTERNAL_TOKEN;
  const supplied = String(req.headers?.authorization || '').replace(/^Bearer\s+/i, '');
  if (!expectedToken || !safeEqual(supplied, expectedToken)) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const payload = await readBody(req);
    const store = new RedisRestRevenuePathStore({
      url: process.env.REDIS_REST_URL,
      token: process.env.REDIS_REST_TOKEN
    });
    const result = await runDomainLandingCycle(payload, { store });
    return res.status(200).json(result);
  } catch (error) {
    const statusCode = Number(error?.statusCode) || 500;
    const safeError = statusCode >= 500 ? 'domain_landing_cycle_failed' : error.message;
    return res.status(statusCode).json({ error: safeError });
  }
}
