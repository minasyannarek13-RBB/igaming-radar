import { probeDomainLanding } from '../src/domain-landing-probe.js';
import { bindTrustedProbeVantage } from '../src/probe-vantage.js';

const MAX_JSON_BYTES = 24_576;

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    if (Buffer.byteLength(req.body) > MAX_JSON_BYTES) {
      throw Object.assign(new Error('payload_too_large'), { statusCode: 413 });
    }
    try {
      return JSON.parse(req.body || '{}');
    } catch {
      throw Object.assign(new Error('invalid_json'), { statusCode: 400 });
    }
  }

  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > MAX_JSON_BYTES) {
      throw Object.assign(new Error('payload_too_large'), { statusCode: 413 });
    }
  }
  try {
    return JSON.parse(body || '{}');
  } catch {
    throw Object.assign(new Error('invalid_json'), { statusCode: 400 });
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  try {
    const payload = await readBody(req);
    const vantage = bindTrustedProbeVantage(payload, process.env);
    const result = await probeDomainLanding(vantage.payload);
    return res.status(200).json({
      ...result,
      requestedGeo: vantage.requestedGeo,
      geoProvenance: vantage.geoProvenance
    });
  } catch (error) {
    const statusCode = Number(error?.statusCode) || 500;
    const safeError = statusCode >= 500 ? 'domain_landing_probe_failed' : error.message;
    return res.status(statusCode).json({ error: safeError });
  }
}
