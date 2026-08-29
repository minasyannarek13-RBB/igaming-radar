import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { scanTarget } from './scanner.js';

const MAX_JSON_BYTES = 16_384;

async function readJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > MAX_JSON_BYTES) {
      const error = new Error('payload_too_large');
      error.statusCode = 413;
      throw error;
    }
  }
  try {
    return JSON.parse(body || '{}');
  } catch {
    const error = new Error('invalid_json');
    error.statusCode = 400;
    throw error;
  }
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

export function createServer({ scan = scanTarget } = {}) {
  return http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      return sendJson(res, 200, { status: 'ok', service: 'igaming-radar', version: '0.1.0' });
    }

    if (req.method === 'POST' && req.url === '/api/scan') {
      try {
        const payload = await readJson(req);
        if (typeof payload.target !== 'string' || payload.target.trim() === '') {
          return sendJson(res, 400, { error: 'target_required' });
        }
        const result = await scan(payload.target.trim());
        return sendJson(res, 200, result);
      } catch (error) {
        const statusCode = Number(error?.statusCode) || 500;
        const safeError = statusCode >= 500 ? 'scan_failed' : error.message;
        return sendJson(res, statusCode, { error: safeError });
      }
    }

    return sendJson(res, 404, { error: 'not_found' });
  });
}

export function startServer({ port = Number(process.env.PORT || 3000), host = '0.0.0.0' } = {}) {
  const server = createServer();
  server.listen(port, host, () => console.log(`iGaming Radar listening on ${port}`));
  return server;
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isDirectRun) startServer();
