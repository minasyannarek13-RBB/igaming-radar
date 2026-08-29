import test from 'node:test';
import assert from 'node:assert/strict';
import { scanTarget, hostnameMatches, normalizeTarget } from '../src/scanner.js';
import { OBSERVATION_STATES } from '../src/evidence.js';

function fakeResponse({ url = 'https://casino.example/', status = 200, headers = {}, body = '' } = {}) {
  const normalized = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    url,
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => normalized.get(name.toLowerCase()) ?? null },
    async text() { return body; }
  };
}

test('hostname matching is suffix-safe', () => {
  assert.equal(hostnameMatches('assets.cloudfront.net', 'cloudfront.net'), true);
  assert.equal(hostnameMatches('cloudfront.net.evil.example', 'cloudfront.net'), false);
});

test('target normalization rejects local and IP literal targets', () => {
  for (const target of ['localhost', 'service.local', '127.0.0.1', '[::1]', 'https://example.com:8080']) {
    assert.throws(() => normalizeTarget(target));
  }
  assert.equal(normalizeTarget('casino.example').hostname, 'casino.example');
});

test('target normalization rejects embedded credentials', () => {
  assert.throws(() => normalizeTarget('https://user:pass@example.com'));
});

test('returns Not observable externally instead of inventing a dependency', async () => {
  const result = await scanTarget('casino.example', {
    fetchImpl: async () => fakeResponse({ body: '<html><script src="/app.js"></script></html>' }),
    now: () => new Date('2026-08-30T00:00:00Z')
  });

  assert.equal(result.state, OBSERVATION_STATES.NOT_OBSERVABLE);
  assert.deepEqual(result.dependencies, []);
  assert.deepEqual(result.evidence, []);
  assert.equal(result.reason, 'no_supported_dependency_signal');
});

test('creates an Observed CloudFront edge only from an explicit public hostname', async () => {
  const result = await scanTarget('casino.example', {
    fetchImpl: async () => fakeResponse({ body: '<script src="https://d111111abcdef8.cloudfront.net/app.js"></script>' }),
    now: () => new Date('2026-08-30T00:00:00Z')
  });

  assert.equal(result.state, OBSERVATION_STATES.OBSERVED);
  assert.equal(result.dependencies.length, 1);
  assert.equal(result.dependencies[0].provider, 'Amazon CloudFront');
  assert.equal(result.dependencies[0].confidence, 'LOW');
  assert.equal(result.evidence[0].state, OBSERVATION_STATES.OBSERVED);
  assert.equal(result.evidence[0].locator, 'd111111abcdef8.cloudfront.net');
  assert.ok(result.dependencies[0].evidenceIds.includes(result.evidence[0].id));
});

test('Cloudflare edge is observed only when cf-ray is present', async () => {
  const result = await scanTarget('casino.example', {
    fetchImpl: async () => fakeResponse({ headers: { 'cf-ray': 'abc123-EVN' }, body: '<html></html>' }),
    now: () => new Date('2026-08-30T00:00:00Z')
  });

  assert.equal(result.dependencies.length, 1);
  assert.equal(result.dependencies[0].provider, 'Cloudflare');
  assert.equal(result.evidence[0].rawSignal, 'cf-ray');
});

test('fetch failure is explicit Not observable externally', async () => {
  const result = await scanTarget('casino.example', {
    fetchImpl: async () => { throw new TypeError('network down'); }
  });

  assert.equal(result.state, OBSERVATION_STATES.NOT_OBSERVABLE);
  assert.equal(result.reason, 'target_fetch_failed');
  assert.deepEqual(result.dependencies, []);
});
