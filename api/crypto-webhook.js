import { processCryptoWebhook } from '../src/crypto-webhook-runtime.js';

const MAX_RAW_BYTES = 65_536;

async function readRawBody(req) {
  if (typeof req.body === 'string') {
    if (Buffer.byteLength(req.body) > MAX_RAW_BYTES) throw Object.assign(new Error('payload_too_large'), { statusCode: 413 });
    return req.body;
  }
  if (Buffer.isBuffer(req.body)) {
    if (req.body.byteLength > MAX_RAW_BYTES) throw Object.assign(new Error('payload_too_large'), { statusCode: 413 });
    return req.body.toString('utf8');
  }
  if (req.body && typeof req.body === 'object') throw new Error('RAW_BODY_UNAVAILABLE');

  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > MAX_RAW_BYTES) throw Object.assign(new Error('payload_too_large'), { statusCode: 413 });
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export const config = {
  api: {
    bodyParser: false
  }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  try {
    const rawBody = await readRawBody(req);
    const result = await processCryptoWebhook({ rawBody, headers: req.headers });
    return res.status(result.statusCode).json(result.body);
  } catch (error) {
    if (error?.statusCode === 413) return res.status(413).json({ error: 'payload_too_large' });
    return res.status(500).json({ error: 'crypto_confirmation_unavailable' });
  }
}
