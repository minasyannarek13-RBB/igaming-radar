import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/revenue-domain-landing-targets.js';

function mockResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; }
  };
}

function redisFetch(memory) {
  return async (_url, init) => {
    const args = JSON.parse(init.body);
    const [command, key, ...rest] = args;
    memory[key] ??= new Map();
    const hash = memory[key];
    let result;
    if (command === 'HSET') {
      hash.set(rest[0], rest[1]);
      result = 1;
    } else if (command === 'HGETALL') {
      result = [...hash.entries()].flat();
    } else if (command === 'HDEL') {
      result = hash.delete(rest[0]) ? 1 : 0;
    } else {
      throw new Error(`unexpected redis command ${command}`);
    }
    return { ok: true, async json() { return { result }; } };
  };
}

async function withEnv(fn) {
  const original = {
    token: process.env.RADAR_INTERNAL_TOKEN,
    redisUrl: process.env.REDIS_REST_URL,
    redisToken: process.env.REDIS_REST_TOKEN,
    fetch: globalThis.fetch
  };
  const memory = {};
  process.env.RADAR_INTERNAL_TOKEN = 'internal-secret';
  process.env.REDIS_REST_URL = 'https://redis.test';
  process.env.REDIS_REST_TOKEN = 'redis-secret';
  globalThis.fetch = redisFetch(memory);
  try {
    await fn(memory);
  } finally {
    if (original.token == null) delete process.env.RADAR_INTERNAL_TOKEN; else process.env.RADAR_INTERNAL_TOKEN = original.token;
    if (original.redisUrl == null) delete process.env.REDIS_REST_URL; else process.env.REDIS_REST_URL = original.redisUrl;
    if (original.redisToken == null) delete process.env.REDIS_REST_TOKEN; else process.env.REDIS_REST_TOKEN = original.redisToken;
    globalThis.fetch = original.fetch;
  }
}

function request(method, { body, query = {}, token = 'internal-secret' } = {}) {
  return {
    method,
    body,
    query,
    headers: token == null ? {} : { authorization: `Bearer ${token}` }
  };
}

test('Domain/Landing target config API durably upserts and lists executable probe config', async () => withEnv(async () => {
  const putRes = mockResponse();
  await handler(request('PUT', { body: {
    scopeId: 'operator-a',
    target: 'https://mirror.example/landing',
    requestedGeo: 'DE',
    recoveryConfirmations: 3,
    config: {
      controlGroup: 'brand-a',
      ctaMarkers: ['deposit', 'play now'],
      errorMarkers: ['service unavailable'],
      challengeMarkers: ['verify you are human'],
      criticalAssetUrls: ['https://mirror.example/app.js'],
      ctaCritical: true
    }
  }}), putRes);

  assert.equal(putRes.statusCode, 200);
  assert.equal(putRes.body.action, 'UPSERTED');
  assert.equal(putRes.body.target.scopeId, 'operator-a');
  assert.equal(putRes.body.target.requestedGeo, 'DE');
  assert.equal(putRes.body.target.config.controlGroup, 'brand-a');
  assert.deepEqual(putRes.body.target.config.ctaMarkers, ['deposit', 'play now']);
  assert.equal(putRes.body.target.config.ctaCritical, true);

  const getRes = mockResponse();
  await handler(request('GET'), getRes);
  assert.equal(getRes.statusCode, 200);
  assert.equal(getRes.body.count, 1);
  assert.deepEqual(getRes.body.targets[0].config, putRes.body.target.config);
}));

test('Domain/Landing target config API requires internal authorization', async () => withEnv(async () => {
  const res = mockResponse();
  await handler(request('GET', { token: null }), res);
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: 'unauthorized' });
}));

test('Domain/Landing target config API rejects invalid probe configuration before persistence', async () => withEnv(async () => {
  const res = mockResponse();
  await handler(request('PUT', { body: {
    scopeId: 'operator-a',
    target: 'https://example.com',
    requestedGeo: 'DE',
    config: { criticalAssetUrls: ['file:///etc/passwd'] }
  }}), res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: 'INVALID_TARGET_SCHEME' });
}));

test('Domain/Landing target config API removes target by deterministic id', async () => withEnv(async () => {
  const putRes = mockResponse();
  await handler(request('PUT', { body: {
    scopeId: 'operator-a',
    target: 'https://example.com',
    requestedGeo: 'DE'
  }}), putRes);

  const deleteRes = mockResponse();
  await handler(request('DELETE', { body: { id: putRes.body.target.id } }), deleteRes);
  assert.equal(deleteRes.statusCode, 200);
  assert.equal(deleteRes.body.action, 'REMOVED');

  const getRes = mockResponse();
  await handler(request('GET'), getRes);
  assert.equal(getRes.body.count, 0);
}));
