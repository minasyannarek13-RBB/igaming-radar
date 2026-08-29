import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';

async function withServer(fn) {
  process.env.NODE_ENV = 'test';
  const server = createServer();
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

test('unknown route is 404', async () => withServer(async base => {
  const response = await fetch(`${base}/missing`);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'not_found' });
}));
