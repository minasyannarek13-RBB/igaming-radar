import { scanTarget } from '../src/scanner.js';

const MAX_JSON_BYTES = 16_384;

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    if (Buffer.byteLength(req.body) > MAX_JSON_BYTES) throw Object.assign(new Error('payload_too_large'), { statusCode: 413 });
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
    if (typeof payload.target !== 'string' || payload.target.trim() === '') {
      return res.status(400).json({ error: 'target_required' });
    }
    const result = await scanTarget(payload.target.trim());
    return res.status(200).json(result);
  } catch (error) {
    const statusCode = Number(error?.statusCode) || 500;
    return res.status(statusCode).json({ error: statusCode >= 500 ? 'scan_failed' : error.message });
  }
}
