import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';

async function withServer(fn, options = {}) {
  process.env.NODE_ENV = 'test';
  const server = createServer(options);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('GET /health returns runtime identity', async () => withServer(async base => {
  const response = await fetch(`${base}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok', service: 'igaming-radar', version: '0.1.0' });
}));

test('POST /api/scan passes target to scanner and returns evidence payload', async () => {
  const expected = {
    target: 'example.com',
    state: 'Observed',
    evidence: [{ id: 'ev-0001' }],
    dependencies: [{ provider: 'Cloudflare', confidence: 'LOW' }]
  };
  await withServer(async base => {
    const response = await fetch(`${base}/api/scan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target: 'example.com' })
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), expected);
  }, { scan: async target => {
    assert.equal(target, 'example.com');
    return expected;
  } });
});

test('POST /api/scan requires target', async () => withServer(async base => {
  const response = await fetch(`${base}/api/scan`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({})
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'target_required' });
}));

test('POST /api/scan rejects malformed JSON', async () => withServer(async base => {
  const response = await fetch(`${base}/api/scan`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{bad-json'
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'invalid_json' });
}));

test('unknown route is 404', async () => withServer(async base => {
  const response = await fetch(`${base}/missing`);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'not_found' });
}));
