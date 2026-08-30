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

test('keeps generic CDN runtime resources unattributed without revenue-path evidence', async () => {
  const runtime = 'https://d111111abcdef8.cloudfront.net/runtime/app.js';
  const result = await scanTarget('casino.example', {
    lookupImpl: publicLookup,
    fetchImpl: async () => fakeResponse(`<script src="${runtime}"></script>`),
    now
  });

  assert.equal(result.state, OBSERVATION_STATES.NOT_OBSERVABLE);
  assert.deepEqual(result.dependencies, []);
  assert.deepEqual(result.evidence, []);
  assert.equal(result.observedSurfaces.length, 1);
  assert.equal(result.observedSurfaces[0].hostname, 'd111111abcdef8.cloudfront.net');
  assert.equal(result.observedSurfaces[0].attribution, 'UNATTRIBUTED');
  assert.deepEqual(result.observedSurfaces[0].sampleResources, [{ path: '/runtime/app.js', attribute: 'src' }]);
});

test('does not attribute a marketing analytics script on shared CDN', async () => {
  const runtime = 'https://d111111abcdef8.cloudfront.net/marketing/analytics.js';
  const result = await scanTarget('casino.example', {
    lookupImpl: publicLookup,
    fetchImpl: async () => fakeResponse(`<script src="${runtime}"></script>`),
    now
  });

  assert.equal(result.state, OBSERVATION_STATES.NOT_OBSERVABLE);
  assert.deepEqual(result.dependencies, []);
  assert.deepEqual(result.evidence, []);
  assert.equal(result.observedSurfaces[0].hostname, 'd111111abcdef8.cloudfront.net');
  assert.equal(result.observedSurfaces[0].attribution, 'UNATTRIBUTED');
});
