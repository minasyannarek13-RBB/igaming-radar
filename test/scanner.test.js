import test from 'node:test';
import assert from 'node:assert/strict';
import { scanTarget, hostnameMatches, normalizeTarget, isPrivateIp, extractExternalResources } from '../src/scanner.js';
import { OBSERVATION_STATES } from '../src/evidence.js';

function fakeResponse({ url = 'https://casino.example/', status = 200, headers = {}, body = '' } = {}) {
  const normalized = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return { url, status, ok: status >= 200 && status < 300, headers: { get: (name) => normalized.get(name.toLowerCase()) ?? null }, async text() { return body; } };
}
const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];

function scan(target, options = {}) { return scanTarget(target, { lookupImpl: publicLookup, ...options }); }

test('hostname matching is suffix-safe', () => {
  assert.equal(hostnameMatches('assets.cloudfront.net', 'cloudfront.net'), true);
  assert.equal(hostnameMatches('cloudfront.net.evil.example', 'cloudfront.net'), false);
});

test('target normalization rejects local and IP literal targets', () => {
  for (const target of ['localhost', 'service.local', '127.0.0.1', '[::1]', 'https://example.com:8080']) assert.throws(() => normalizeTarget(target));
  assert.equal(normalizeTarget('casino.example').hostname, 'casino.example');
});

test('target normalization rejects embedded credentials', () => assert.throws(() => normalizeTarget('https://user:pass@example.com')));

test('private and reserved IP ranges are rejected', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.1.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '::1', 'fc00::1', 'fe80::1']) assert.equal(isPrivateIp(ip), true, ip);
  assert.equal(isPrivateIp('8.8.8.8'), false);
  assert.equal(isPrivateIp('2606:4700:4700::1111'), false);
});

test('DNS resolution to private address is blocked before fetch', async () => {
  let fetched = false;
  const result = await scanTarget('casino.example', {
    lookupImpl: async () => [{ address: '169.254.169.254', family: 4 }],
    fetchImpl: async () => { fetched = true; return fakeResponse(); }
  });
  assert.equal(fetched, false);
  assert.equal(result.state, OBSERVATION_STATES.NOT_OBSERVABLE);
  assert.match(result.detail, /non-public/);
});

test('public redirect to private-resolving hostname is blocked before second fetch', async () => {
  const fetched = [];
  const result = await scanTarget('casino.example', {
    lookupImpl: async (hostname) => hostname === 'internal.example' ? [{ address: '10.0.0.7', family: 4 }] : [{ address: '93.184.216.34', family: 4 }],
    fetchImpl: async (url) => {
      fetched.push(url.hostname);
      return fakeResponse({ status: 302, headers: { location: 'http://internal.example/admin' } });
    }
  });
  assert.deepEqual(fetched, ['casino.example']);
  assert.equal(result.state, OBSERVATION_STATES.NOT_OBSERVABLE);
  assert.match(result.detail, /non-public/);
});

test('extracts resource path and attribute without attributing a provider', () => {
  const resources = extractExternalResources('<script src="https://vendor.example/runtime/game.js?v=7"></script><link href="/style.css">', new URL('https://casino.example/'));
  assert.deepEqual(resources, [
    { url: 'https://vendor.example/runtime/game.js?v=7', hostname: 'vendor.example', path: '/runtime/game.js?v=7', attribute: 'src' },
    { url: 'https://casino.example/style.css', hostname: 'casino.example', path: '/style.css', attribute: 'href' }
  ]);
});

test('returns Not observable externally instead of inventing a dependency', async () => {
  const result = await scan('casino.example', { fetchImpl: async () => fakeResponse({ body: '<html><script src="/app.js"></script></html>' }), now: () => new Date('2026-08-30T00:00:00Z') });
  assert.equal(result.state, OBSERVATION_STATES.NOT_OBSERVABLE); assert.deepEqual(result.dependencies, []); assert.deepEqual(result.evidence, []); assert.equal(result.reason, 'no_supported_dependency_signal');
});

test('inventories external surfaces with resource context without turning them into dependency attribution', async () => {
  const result = await scan('casino.example', { fetchImpl: async () => fakeResponse({ body: '<script src="https://unknown-vendor.example/runtime/app.js?v=2"></script><link href="https://casino.example/style.css">' }), now: () => new Date('2026-08-30T00:00:00Z') });
  assert.equal(result.state, OBSERVATION_STATES.NOT_OBSERVABLE); assert.deepEqual(result.dependencies, []); assert.deepEqual(result.evidence, []);
  assert.deepEqual(result.observedSurfaces, [{ hostname: 'unknown-vendor.example', state: OBSERVATION_STATES.OBSERVED, attribution: 'UNATTRIBUTED', evidenceClass: 'html_external_hostname', sampleResources: [{ path: '/runtime/app.js?v=2', attribute: 'src' }] }]);
});

test('creates an Observed CloudFront edge only from an explicit public hostname', async () => {
  const result = await scan('casino.example', { fetchImpl: async () => fakeResponse({ body: '<script src="https://d111111abcdef8.cloudfront.net/app.js"></script>' }), now: () => new Date('2026-08-30T00:00:00Z') });
  assert.equal(result.state, OBSERVATION_STATES.OBSERVED); assert.equal(result.dependencies.length, 1); assert.equal(result.dependencies[0].provider, 'Amazon CloudFront'); assert.equal(result.dependencies[0].confidence, 'LOW'); assert.equal(result.evidence[0].state, OBSERVATION_STATES.OBSERVED); assert.equal(result.evidence[0].locator, 'd111111abcdef8.cloudfront.net'); assert.ok(result.dependencies[0].evidenceIds.includes(result.evidence[0].id));
});

test('Cloudflare edge is observed only when cf-ray is present', async () => {
  const result = await scan('casino.example', { fetchImpl: async () => fakeResponse({ headers: { 'cf-ray': 'abc123-EVN' }, body: '<html></html>' }), now: () => new Date('2026-08-30T00:00:00Z') });
  assert.equal(result.dependencies.length, 1); assert.equal(result.dependencies[0].provider, 'Cloudflare'); assert.equal(result.evidence[0].rawSignal, 'cf-ray');
});

test('fetch failure is explicit Not observable externally', async () => {
  const result = await scan('casino.example', { fetchImpl: async () => { throw new TypeError('network down'); } });
  assert.equal(result.state, OBSERVATION_STATES.NOT_OBSERVABLE); assert.equal(result.reason, 'target_fetch_failed'); assert.deepEqual(result.dependencies, []); assert.deepEqual(result.observedSurfaces, []);
});
