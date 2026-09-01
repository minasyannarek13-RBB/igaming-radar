import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRevenuePathAlert } from '../src/revenue-path-alert.js';

function classified(overrides = {}) {
  return {
    state: 'BROKEN',
    scope: 'geo-local-observed',
    attributable: false,
    cause: 'NOT_OBSERVABLE',
    dependencyEdges: 0,
    evidence: {
      geo: 'DE',
      evidenceClass: 'LIVE_OBSERVED',
      observations: { http: 451, page: 'unavailable' },
      controls: [
        { geo: 'NL', state: 'HEALTHY' },
        { geo: 'GB', state: 'HEALTHY' }
      ]
    },
    ...overrides
  };
}

function openLifecycle(overrides = {}) {
  return {
    state: 'BROKEN',
    incidentOpen: true,
    firstDetected: '2026-08-31T00:00:00.000Z',
    lastObservedAt: '2026-08-31T00:00:00.000Z',
    recoveryCandidateAt: null,
    recoveredAt: null,
    incidentOpenDurationMs: 0,
    observedExposureUpperBoundMs: null,
    ...overrides
  };
}

test('incident alert is factual, provenance-backed and does not claim saved GGR', () => {
  const payload = buildRevenuePathAlert({
    target: 'https://example.test/de',
    classified: classified(),
    lifecycle: openLifecycle(),
    observedAt: '2026-08-31T00:00:00.000Z'
  });

  assert.equal(payload.event, 'INCIDENT_OPEN');
  assert.equal(payload.state, 'BROKEN');
  assert.equal(payload.geo, 'DE');
  assert.equal(payload.scope, 'geo-local-observed');
  assert.equal(payload.attribution.status, 'NOT_OBSERVABLE_EXTERNALLY');
  assert.equal(payload.attribution.dependencyEdges, 0);
  assert.equal(payload.roiProof.status, 'NOT_CLAIMED');
  assert.equal(payload.roiProof.savedGgr, null);
  assert.equal(payload.roiProof.savedRevenue, null);
  assert.equal('exposureDurationMs' in payload, false);
  assert.deepEqual(payload.evidence.observations, { http: 451, page: 'unavailable' });
});

test('repeated unhealthy observation becomes update and carries incident-open duration only', () => {
  const payload = buildRevenuePathAlert({
    target: 'https://example.test',
    classified: classified({ state: 'DEGRADED', scope: 'conversion-path' }),
    lifecycle: openLifecycle({
      state: 'DEGRADED',
      lastObservedAt: '2026-08-31T00:05:00.000Z',
      incidentOpenDurationMs: 300000
    }),
    observedAt: '2026-08-31T00:05:00.000Z'
  });

  assert.equal(payload.event, 'INCIDENT_UPDATE');
  assert.equal(payload.incidentOpenDurationMs, 300000);
  assert.equal(payload.observedExposureUpperBoundMs, null);
  assert.equal('exposureDurationMs' in payload, false);
});

test('NOT_OBSERVABLE observation cannot create an incident alert', () => {
  const payload = buildRevenuePathAlert({
    target: 'https://example.test',
    classified: classified({ state: 'NOT_OBSERVABLE', scope: 'probe-ambiguous' }),
    lifecycle: {
      ...openLifecycle(),
      state: 'NOT_OBSERVABLE',
      incidentOpen: false
    },
    observedAt: '2026-08-31T00:00:00.000Z'
  });

  assert.equal(payload, null);
});

test('recovery separates confirmation duration from observed exposure upper bound', () => {
  const payload = buildRevenuePathAlert({
    target: 'https://example.test',
    classified: classified({
      state: 'HEALTHY',
      scope: 'none',
      evidence: {
        geo: 'DE',
        evidenceClass: 'LIVE_OBSERVED',
        observations: { dns: 'ok', tls: 'ok', http: 200 },
        controls: []
      }
    }),
    lifecycle: {
      state: 'HEALTHY',
      incidentOpen: false,
      firstDetected: '2026-08-31T00:00:00.000Z',
      lastObservedAt: '2026-08-31T00:20:00.000Z',
      recoveryCandidateAt: '2026-08-31T00:10:00.000Z',
      recoveredAt: '2026-08-31T00:20:00.000Z',
      incidentOpenDurationMs: 1200000,
      observedExposureUpperBoundMs: 600000
    },
    observedAt: '2026-08-31T00:20:00.000Z'
  });

  assert.equal(payload.event, 'RECOVERY');
  assert.equal(payload.state, 'HEALTHY');
  assert.equal(payload.recoveryCandidateAt, '2026-08-31T00:10:00.000Z');
  assert.equal(payload.recoveredAt, '2026-08-31T00:20:00.000Z');
  assert.equal(payload.incidentOpenDurationMs, 1200000);
  assert.equal(payload.observedExposureUpperBoundMs, 600000);
  assert.equal('exposureDurationMs' in payload, false);
  assert.equal(payload.roiProof.status, 'NOT_CLAIMED');
});

test('stale observation cannot generate an alert from newer lifecycle state', () => {
  assert.throws(() => buildRevenuePathAlert({
    target: 'https://example.test',
    classified: classified(),
    lifecycle: openLifecycle({ lastObservedAt: '2026-08-31T00:05:00.000Z' }),
    observedAt: '2026-08-31T00:00:00.000Z'
  }), /latest persisted observation/);
});

test('classification without provenance is rejected', () => {
  assert.throws(() => buildRevenuePathAlert({
    target: 'https://example.test',
    classified: { state: 'BROKEN', scope: 'target' },
    lifecycle: openLifecycle(),
    observedAt: '2026-08-31T00:00:00.000Z'
  }), /evidence required/);
});
