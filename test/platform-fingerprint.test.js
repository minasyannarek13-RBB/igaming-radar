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
const now = () => new Date('2026-08-30T08:00:00Z');

async function scan(body) {
  return scanTarget('operator.example', {
    lookupImpl: publicLookup,
    fetchImpl: async () => fakeResponse(body),
    now
  });
}

test('attributes corroborated Entain shared application runtime at LOW confidence', async () => {
  const result = await scan('<script src="https://scmedia.itsfogo.com/$-$/7187bf0a675b46a89627b38d9d3d0f66.js"></script>');

  assert.equal(result.state, OBSERVATION_STATES.OBSERVED);
  assert.equal(result.dependencies.length, 1);
  assert.equal(result.dependencies[0].provider, 'Entain');
  assert.equal(result.dependencies[0].capability, 'Sportsbook/Platform');
  assert.equal(result.dependencies[0].component, 'Shared application runtime');
  assert.equal(result.dependencies[0].confidence, 'LOW');
  assert.equal(result.evidence[0].locator, 'scmedia.itsfogo.com');
});

test('does not attribute Entain from a hyperlink to a runtime-looking path', async () => {
  const result = await scan('<a href="https://scmedia.itsfogo.com/$-$/7187bf0a675b46a89627b38d9d3d0f66.js">info</a>');

  assert.equal(result.state, OBSERVATION_STATES.NOT_OBSERVABLE);
  assert.deepEqual(result.dependencies, []);
  assert.equal(result.observedSurfaces[0].attribution, 'UNATTRIBUTED');
});

test('does not attribute Entain from generic media on the shared domain', async () => {
  const result = await scan('<img src="https://media.itsfogo.com/media/sccmsupload/Vanilla/Whitelabel/App/Help/blocked-bwin.jpg">');

  assert.equal(result.state, OBSERVATION_STATES.NOT_OBSERVABLE);
  assert.deepEqual(result.dependencies, []);
  assert.equal(result.observedSurfaces[0].hostname, 'media.itsfogo.com');
  assert.equal(result.observedSurfaces[0].attribution, 'UNATTRIBUTED');
});

test('does not attribute Entain from an itsfogo suffix spoof', async () => {
  const result = await scan('<script src="https://scmedia.itsfogo.com.attacker.example/$-$/7187bf0a675b46a89627b38d9d3d0f66.js"></script>');

  assert.equal(result.state, OBSERVATION_STATES.NOT_OBSERVABLE);
  assert.deepEqual(result.dependencies, []);
});

test('does not attribute unrelated itsfogo hosts even with a runtime-looking path', async () => {
  const result = await scan('<script src="https://delivery.itsfogo.com/$-$/7187bf0a675b46a89627b38d9d3d0f66.js"></script>');

  assert.equal(result.state, OBSERVATION_STATES.NOT_OBSERVABLE);
  assert.deepEqual(result.dependencies, []);
  assert.equal(result.observedSurfaces[0].attribution, 'UNATTRIBUTED');
});
