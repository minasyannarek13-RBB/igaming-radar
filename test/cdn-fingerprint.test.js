import test from 'node:test';
import assert from 'node:assert/strict';
import { scanTarget } from '../src/scanner.js';
import { OBSERVATION_STATES } from '../src/evidence.js';

function fakeResponse(body) {
  return {
    status: 200,
    ok: true,
    headers: { get: () => null },
    async text() { return body; }
  };
}

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];
const now = () => new Date('2026-08-30T07:00:00Z');

test('does not create a CDN dependency from a plain marketing hyperlink', async () => {
  const result = await scanTarget('casino.example', {
    lookupImpl: publicLookup,
    fetchImpl: async () => fakeResponse('<a href="https://d111111abcdef8.cloudfront.net/">CDN information</a>'),
    now
  });

  assert.equal(result.state, OBSERVATION_STATES.NOT_OBSERVABLE);
  assert.deepEqual(result.dependencies, []);
  assert.deepEqual(result.evidence, []);
  assert.equal(result.observedSurfaces.length, 1);
  assert.equal(result.observedSurfaces[0].hostname, 'd111111abcdef8.cloudfront.net');
  assert.equal(result.observedSurfaces[0].attribution, 'UNATTRIBUTED');
});

test('keeps explicit CDN runtime resources attributable at LOW confidence with auditable corroboration', async () => {
  const runtime = 'https://d111111abcdef8.cloudfront.net/runtime/app.js';
  const result = await scanTarget('casino.example', {
    lookupImpl: publicLookup,
    fetchImpl: async () => fakeResponse(`<script src="${runtime}"></script>`),
    now
  });

  assert.equal(result.state, OBSERVATION_STATES.OBSERVED);
  assert.equal(result.dependencies.length, 1);
  assert.equal(result.dependencies[0].provider, 'Amazon CloudFront');
  assert.equal(result.dependencies[0].capability, 'CDN/Cloud');
  assert.equal(result.dependencies[0].confidence, 'LOW');
  assert.equal(result.evidence[0].evidenceClass, 'runtime_resource_http');
  assert.equal(result.evidence[0].locator, runtime);
  assert.equal(result.evidence[0].requestedUrl, runtime);
  assert.equal(result.evidence[0].finalUrl, runtime);
  assert.equal(result.evidence[0].finalHostname, 'd111111abcdef8.cloudfront.net');
  assert.equal(result.evidence[0].httpStatus, 200);
});
