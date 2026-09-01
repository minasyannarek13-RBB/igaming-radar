import test from 'node:test';
import assert from 'node:assert/strict';
import { probeDomainLanding } from '../src/domain-landing-probe.js';

const NOW = new Date('2026-08-31T18:00:00.000Z');
const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];

function response(status, body = '', headers = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get(name) { return headers[String(name).toLowerCase()] ?? null; } },
    async text() { return body; },
    async discard() {}
  };
}

test('live Domain/Landing probe reports HEALTHY without revenue attribution or ROI claims', async () => {
  const result = await probeDomainLanding({
    target: 'https://operator.example/landing',
    geo: 'DE',
    config: { ctaCritical: true, ctaMarkers: ['data-radar="register"'] }
  }, {
    lookupImpl: publicLookup,
    fetchImpl: async () => response(200, '<a data-radar="register" href="/register">Register</a>'),
    now: () => NOW
  });

  assert.equal(result.state, 'HEALTHY');
  assert.equal(result.evidence.evidenceClass, 'LIVE_OBSERVED');
  assert.equal(result.evidence.geo, 'DE');
  assert.equal(result.attribution, 'Not observable externally');
  assert.equal(result.dependencyEdges, 0);
  assert.deepEqual(result.roiProof, { status: 'NOT_CLAIMED', savedGgr: null, savedRevenue: null });
});

test('single automated landing HTTP 5xx is NOT_OBSERVABLE until trusted sequential corroboration', async () => {
  const result = await probeDomainLanding({
    target: 'https://operator.example/landing',
    geo: 'DE'
  }, {
    lookupImpl: publicLookup,
    fetchImpl: async () => response(500, '<html><body>Internal server error</body></html>'),
    now: () => NOW
  });

  assert.equal(result.state, 'NOT_OBSERVABLE');
  assert.equal(result.scope, 'http-5xx-probe-ambiguous');
  assert.equal(result.evidence.observations.http, 500);
  assert.equal(result.evidence.observations.http5xxConfirmations, 1);
  assert.equal(result.failureSignature, 'http:500');
  assert.equal(result.failureConfirmations, 1);
  assert.equal(result.cause, 'NOT_OBSERVABLE');
  assert.equal(result.attribution, 'Not observable externally');
  assert.equal(result.dependencyEdges, 0);
  assert.deepEqual(result.roiProof, { status: 'NOT_CLAIMED', savedGgr: null, savedRevenue: null });
});

test('single configured critical asset failure remains NOT_OBSERVABLE with exact observed asset evidence', async () => {
  const fetchImpl = async (url) => {
    if (url.href.includes('critical.js')) return response(503, 'unavailable');
    return response(200, '<html>ok</html>');
  };

  const result = await probeDomainLanding({
    target: 'https://operator.example/landing',
    geo: 'AM',
    config: { criticalAssetUrls: ['https://static.example/critical.js'] }
  }, { lookupImpl: publicLookup, fetchImpl, now: () => NOW });

  assert.equal(result.state, 'NOT_OBSERVABLE');
  assert.equal(result.scope, 'landing-assets-probe-ambiguous');
  assert.equal(result.evidence.observations.criticalAssets, 'broken');
  assert.equal(result.evidence.observations.criticalAssetConfirmations, 1);
  assert.equal(result.evidence.observations.criticalAssetEvidence[0].httpStatus, 503);
  assert.equal(result.evidence.observations.criticalAssetEvidence[0].provenance, 'Observed');
  assert.equal(result.failureSignature, 'asset:https://static.example/critical.js:503');
  assert.equal(result.failureConfirmations, 1);
  assert.equal(result.cause, 'NOT_OBSERVABLE');
});

test('single critical CTA miss remains NOT_OBSERVABLE until trusted sequential corroboration', async () => {
  const result = await probeDomainLanding({
    target: 'https://operator.example/landing',
    geo: 'GB',
    config: { ctaCritical: true, ctaMarkers: ['id="deposit-now"'] }
  }, {
    lookupImpl: publicLookup,
    fetchImpl: async () => response(200, '<html><body>Welcome</body></html>'),
    now: () => NOW
  });

  assert.equal(result.state, 'NOT_OBSERVABLE');
  assert.equal(result.scope, 'conversion-path-probe-ambiguous');
  assert.equal(result.evidence.observations.cta, 'missing');
  assert.equal(result.evidence.observations.ctaConfirmations, 1);
  assert.equal(result.failureConfirmations, 1);
  assert.equal(result.attribution, 'Not observable externally');
});

test('automated WAF challenge is NOT_OBSERVABLE rather than false downtime', async () => {
  const result = await probeDomainLanding({
    target: 'https://operator.example/landing',
    geo: 'NL',
    config: { challengeMarkers: ['verify you are human'] }
  }, {
    lookupImpl: publicLookup,
    fetchImpl: async () => response(403, '<h1>Verify you are human</h1>'),
    now: () => NOW
  });

  assert.equal(result.state, 'NOT_OBSERVABLE');
  assert.equal(result.scope, 'probe-ambiguous');
  assert.equal(result.cause, 'NOT_OBSERVABLE');
});

test('caller-supplied healthy mirror control cannot promote HTTP 451 into BROKEN scope', async () => {
  const result = await probeDomainLanding({
    target: 'https://operator.example/landing',
    geo: 'IAD1',
    controls: [
      { target: 'https://mirror.example', geo: 'IAD1', state: 'HEALTHY' }
    ]
  }, {
    lookupImpl: publicLookup,
    fetchImpl: async () => response(451, '<html><body>Unavailable</body></html>'),
    now: () => NOW
  });

  assert.equal(result.state, 'NOT_OBSERVABLE');
  assert.equal(result.scope, 'geo-ambiguous');
  assert.equal(result.cause, 'NOT_OBSERVABLE');
  assert.equal(result.dependencyEdges, 0);
  assert.equal(result.attribution, 'Not observable externally');
});

test('caller-supplied cross-GEO healthy controls cannot promote HTTP 403 into geo-local BROKEN', async () => {
  const result = await probeDomainLanding({
    target: 'https://operator.example/landing',
    geo: 'IAD1',
    controls: [
      { target: 'https://operator.example/landing', geo: 'FRA1', state: 'HEALTHY' },
      { target: 'https://operator.example/landing', geo: 'GRU1', state: 'HEALTHY' }
    ]
  }, {
    lookupImpl: publicLookup,
    fetchImpl: async () => response(403, '<html><body>Unavailable</body></html>'),
    now: () => NOW
  });

  assert.equal(result.state, 'NOT_OBSERVABLE');
  assert.equal(result.scope, 'geo-ambiguous');
  assert.equal(result.cause, 'NOT_OBSERVABLE');
  assert.equal(result.dependencyEdges, 0);
  assert.equal(result.attribution, 'Not observable externally');
});

test('redirect loop is observed as BROKEN but does not invent blocking cause', async () => {
  const result = await probeDomainLanding({
    target: 'https://operator.example/a',
    geo: 'DE'
  }, {
    lookupImpl: publicLookup,
    fetchImpl: async (url) => response(302, '', { location: url.pathname === '/a' ? '/b' : '/a' }),
    now: () => NOW
  });

  assert.equal(result.state, 'BROKEN');
  assert.equal(result.scope, 'target');
  assert.equal(result.cause, 'NOT_OBSERVABLE');
  assert.equal(result.attribution, 'Not observable externally');
});

test('private DNS resolution fails closed before fetch and cannot become an outage claim', async () => {
  let fetched = false;
  const result = await probeDomainLanding({ target: 'https://operator.example/landing', geo: 'DE' }, {
    lookupImpl: async () => [{ address: '127.0.0.1', family: 4 }],
    fetchImpl: async () => { fetched = true; return response(200, 'should not run'); },
    now: () => NOW
  });

  assert.equal(fetched, false);
  assert.equal(result.state, 'NOT_OBSERVABLE');
  assert.equal(result.dependencyEdges, 0);
  assert.equal(result.attribution, 'Not observable externally');
});
