import test from 'node:test';
import assert from 'node:assert/strict';
import { correlateAndAttribute } from '../src/correlation-attribution.js';

const obs = (x = {}) => ({
  observedAt: '2024-02-01T12:00:00Z',
  dependencyId: 'betconstruct-platform',
  status: 'UNHEALTHY',
  evidenceId: 'hist-a',
  provenanceFamily: 'historical-source-a',
  operatorId: 'operator-a',
  ...x
});

test('historical replay: shared platform incident can correlate with guarded HIGH confidence', () => {
  const result = correlateAndAttribute([
    obs(),
    obs({ operatorId: 'operator-b', evidenceId: 'hist-b', provenanceFamily: 'historical-source-b' }),
    obs({ operatorId: 'unrelated-control', status: 'HEALTHY', control: true, evidenceId: 'hist-control', provenanceFamily: 'historical-control' })
  ]);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].dependencyId, 'betconstruct-platform');
  assert.equal(result.candidates[0].confidence, 'HIGH');
});

test('historical replay: timing outside correlation window is rejected', () => {
  const result = correlateAndAttribute([
    obs(),
    obs({ operatorId: 'operator-b', observedAt: '2024-02-01T12:10:01Z', evidenceId: 'hist-b', provenanceFamily: 'historical-source-b' })
  ]);
  assert.equal(result.candidates.length, 0);
});

test('historical replay: unrelated operators with different dependencies are not attributed', () => {
  const result = correlateAndAttribute([
    obs(),
    obs({ operatorId: 'operator-b', dependencyId: 'different-platform', evidenceId: 'hist-b', provenanceFamily: 'historical-source-b' })
  ]);
  assert.equal(result.candidates.length, 0);
});
