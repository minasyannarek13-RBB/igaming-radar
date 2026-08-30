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
const now = () => new Date('2026-08-30T04:00:00Z');

test("attributes an explicit playngonetwork.com runtime surface to Play'n GO at LOW confidence", async () => {
  const result = await scanTarget('casino.example', {
    lookupImpl: publicLookup,
    fetchImpl: async () => fakeResponse('<iframe src="https://operator-cw.playngonetwork.com/casino/game/index.html"></iframe>'),
    now
  });

  assert.equal(result.state, OBSERVATION_STATES.OBSERVED);
  assert.equal(result.dependencies.length, 1);
  assert.deepEqual(result.dependencies[0], {
    operator: 'casino.example',
    capability: 'Game Provider/RGS',
    provider: "Play'n GO",
    component: 'Game delivery network',
    confidence: 'LOW',
    evidenceIds: ['ev-0001']
  });
  assert.equal(result.evidence[0].locator, 'operator-cw.playngonetwork.com');
  assert.equal(result.evidence[0].rawSignal, 'playngonetwork.com');
});

test('does not attribute suffix-spoofed Play n GO hostnames', async () => {
  const result = await scanTarget('casino.example', {
    lookupImpl: publicLookup,
    fetchImpl: async () => fakeResponse('<iframe src="https://playngonetwork.com.evil.example/game"></iframe>'),
    now
  });

  assert.equal(result.state, OBSERVATION_STATES.NOT_OBSERVABLE);
  assert.deepEqual(result.dependencies, []);
  assert.equal(result.observedSurfaces[0].hostname, 'playngonetwork.com.evil.example');
  assert.equal(result.observedSurfaces[0].attribution, 'UNATTRIBUTED');
});
