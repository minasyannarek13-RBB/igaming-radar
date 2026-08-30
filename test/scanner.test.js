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

test('IPv4-mapped IPv6 is normalized through the IPv4 public-range guard', () => {
  for (const ip of ['::ffff:127.0.0.1', '::ffff:10.2.3.4', '::ffff:172.16.1.1', '::ffff:192.168.4.5', '::ffff:169.254.169.254', '::ffff:100.64.1.2', '::ffff:ac10:0101', '::ffff:6440:0102']) {
    assert.equal(isPrivateIp(ip), true, ip);
  }
  assert.equal(isPrivateIp('::ffff:8.8.8.8'), false);
  assert.equal(isPrivateIp('::ffff:0808:0808'), false);
});

test('IPv6 transition and special ranges are fail-closed for SSRF', () => {
  for (const ip of [
    '::7f00:1',
    '0:0:0:0:0:0:7f00:1',
    '64:ff9b::7f00:1',
    '0064:ff9b::7f00:1',
    '64:ff9b:1::7f00:1',
    '100::1',
    '2001:0::1',
    '2001:2::1',
    '2001:db8::1',
    '2002:7f00:1::'
  ]) assert.equal(isPrivateIp(ip), true, ip);
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

test('DNS resolution to IPv6 transition range is blocked before fetch', async () => {
  let fetched = false;
  const result = await scanTarget('casino.example', {
    lookupImpl: async () => [{ address: '64:ff9b::7f00:1', family: 6 }],
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

test('redirected final operator host is not inventoried as an external surface', async () => {
  const responses = [
    fakeResponse({ status: 302, headers: { location: 'https://www.casino.example/' } }),
    fakeResponse({ url: 'https://www.casino.example/', body: '<script src="https://www.casino.example/app.js"></script><link href="https://cdn.vendor.example/style.css">' })
  ];
  const result = await scanTarget('casino.example', {
    lookupImpl: publicLookup,
    fetchImpl: async () => responses.shift(),
    now: () => new Date('2026-08-30T00:00:00Z')
  });
  assert.equal(result.state, OBSERVATION_STATES.NOT_OBSERVABLE);
  assert.deepEqual(result.dependencies, []);
  assert.deepEqual(result.observedSurfaces, [{ hostname: 'cdn.vendor.example', state: OBSERVATION_STATES.OBSERVED, attribution: 'UNATTRIBUTED', evidenceClass: 'html_external_hostname', sampleResources: [{ path: '/style.css', attribute: 'href' }] }]);
});

test('keeps generic CloudFront runtime as an unattributed observed surface', async () => {
  const runtime = 'https://d111111abcdef8.cloudfront.net/app.js';
  const result = await scan('casino.example', { fetchImpl: async () => fakeResponse({ body: `<script src="${runtime}"></script>` }), now: () => new Date('2026-08-30T00:00:00Z') });
  assert.equal(result.state, OBSERVATION_STATES.NOT_OBSERVABLE);
  assert.deepEqual(result.dependencies, []);
  assert.deepEqual(result.evidence, []);
  assert.deepEqual(result.observedSurfaces, [{ hostname: 'd111111abcdef8.cloudfront.net', state: OBSERVATION_STATES.OBSERVED, attribution: 'UNATTRIBUTED', evidenceClass: 'html_external_hostname', sampleResources: [{ path: '/app.js', attribute: 'src' }] }]);
});

test('cf-ray alone never creates a Cloudflare dependency edge', async () => {
  const result = await scan('casino.example', { fetchImpl: async () => fakeResponse({ headers: { 'cf-ray': 'abc123-EVN' }, body: '<html></html>' }), now: () => new Date('2026-08-30T00:00:00Z') });
  assert.equal(result.state, OBSERVATION_STATES.NOT_OBSERVABLE);
  assert.equal(result.reason, 'no_supported_dependency_signal');
  assert.deepEqual(result.dependencies, []);
  assert.deepEqual(result.evidence, []);
});

test('fetch failure is explicit Not observable externally', async () => {
  const result = await scan('casino.example', { fetchImpl: async () => { throw new TypeError('network down'); } });
  assert.equal(result.state, OBSERVATION_STATES.NOT_OBSERVABLE); assert.equal(result.reason, 'target_fetch_failed'); assert.deepEqual(result.dependencies, []); assert.deepEqual(result.observedSurfaces, []);
});