import test from 'node:test';
import assert from 'node:assert/strict';

import {
  advanceRevenuePathLifecycle,
  classifyDomainLanding,
  initialRevenuePathLifecycle
} from '../src/revenue-path.js';
import { buildRevenuePathAlert } from '../src/revenue-path-alert.js';
import { domainLandingFixtures } from './fixtures/revenue-path-domain-landing.js';

for (const fixture of domainLandingFixtures) {
  test(`Domain/Landing fixture: ${fixture.id}`, () => {
    const classified = classifyDomainLanding(fixture);
    assert.equal(classified.state, fixture.expected.state);
    assert.equal(classified.scope, fixture.expected.scope);
    assert.equal(classified.attributable, fixture.expected.attributable);
    if ('cause' in fixture.expected) assert.equal(classified.cause, fixture.expected.cause);
    if ('dependencyEdges' in fixture.expected) {
      assert.equal(classified.dependencyEdges, fixture.expected.dependencyEdges);
    }

    assert.equal(classified.evidence.geo, fixture.geo);
    assert.equal(classified.evidence.evidenceClass, 'SYNTHETIC_TEST');
    assert.deepEqual(classified.evidence.observations, fixture.observations);
    assert.deepEqual(classified.evidence.controls, fixture.controls ?? []);
  });
}

test('Domain/Landing incident -> healthy controls -> recovery preserves factual exposure duration', () => {
  const broken = classifyDomainLanding(domainLandingFixtures.find((fixture) => fixture.id === 'geo-local-failure'));
  const healthy = classifyDomainLanding(domainLandingFixtures.find((fixture) => fixture.id === 'healthy-control'));

  let lifecycle = initialRevenuePathLifecycle();
  lifecycle = advanceRevenuePathLifecycle(lifecycle, broken, '2026-08-31T10:00:00.000Z');
  assert.equal(lifecycle.incidentOpen, true);
  assert.equal(lifecycle.firstDetected, '2026-08-31T10:00:00.000Z');

  const opened = buildRevenuePathAlert({
    classified: broken,
    lifecycle,
    target: 'https://geo-local.example/landing',
    observedAt: '2026-08-31T10:00:00.000Z'
  });
  assert.equal(opened.event, 'INCIDENT_OPEN');
  assert.equal(opened.state, 'BROKEN');
  assert.equal(opened.attribution.status, 'NOT_OBSERVABLE_EXTERNALLY');
  assert.equal(opened.attribution.dependencyEdges, 0);
  assert.equal(opened.roiProof.status, 'NOT_CLAIMED');
  assert.equal(opened.roiProof.savedGgr, null);
  assert.equal(opened.roiProof.savedRevenue, null);

  lifecycle = advanceRevenuePathLifecycle(lifecycle, healthy, '2026-08-31T10:05:00.000Z');
  assert.equal(lifecycle.incidentOpen, true);
  assert.equal(lifecycle.state, 'BROKEN');
  assert.equal(lifecycle.recoveredAt, null);

  lifecycle = advanceRevenuePathLifecycle(lifecycle, healthy, '2026-08-31T10:10:00.000Z');
  assert.equal(lifecycle.incidentOpen, false);
  assert.equal(lifecycle.state, 'HEALTHY');
  assert.equal(lifecycle.recoveredAt, '2026-08-31T10:10:00.000Z');
  assert.equal(lifecycle.exposureDurationMs, 10 * 60 * 1000);

  const recovery = buildRevenuePathAlert({
    classified: healthy,
    lifecycle,
    target: 'https://geo-local.example/landing',
    observedAt: '2026-08-31T10:10:00.000Z'
  });
  assert.equal(recovery.event, 'RECOVERY');
  assert.equal(recovery.exposureDurationMs, 10 * 60 * 1000);
  assert.equal(recovery.roiProof.status, 'NOT_CLAIMED');
});

test('NOT_OBSERVABLE cannot close an open Domain/Landing incident', () => {
  const broken = classifyDomainLanding(domainLandingFixtures.find((fixture) => fixture.id === 'redirect-loop'));
  const ambiguous = classifyDomainLanding(domainLandingFixtures.find((fixture) => fixture.id === 'waf-bot-ambiguous'));

  let lifecycle = advanceRevenuePathLifecycle(
    initialRevenuePathLifecycle(),
    broken,
    '2026-08-31T11:00:00.000Z'
  );
  lifecycle = advanceRevenuePathLifecycle(lifecycle, ambiguous, '2026-08-31T11:05:00.000Z');

  assert.equal(lifecycle.incidentOpen, true);
  assert.equal(lifecycle.state, 'BROKEN');
  assert.equal(lifecycle.recoveredAt, null);
  assert.equal(lifecycle.healthyConfirmations, 0);
});

test('delayed/duplicate observations cannot rewrite recovery or exposure duration', () => {
  const broken = classifyDomainLanding(domainLandingFixtures.find((fixture) => fixture.id === 'redirect-loop'));
  const healthy = classifyDomainLanding(domainLandingFixtures.find((fixture) => fixture.id === 'healthy-control'));

  let lifecycle = advanceRevenuePathLifecycle(
    initialRevenuePathLifecycle(),
    broken,
    '2026-08-31T12:00:00.000Z'
  );
  lifecycle = advanceRevenuePathLifecycle(lifecycle, healthy, '2026-08-31T12:05:00.000Z');
  const beforeDuplicate = lifecycle;
  lifecycle = advanceRevenuePathLifecycle(lifecycle, healthy, '2026-08-31T12:05:00.000Z');
  assert.deepEqual(lifecycle, beforeDuplicate);

  lifecycle = advanceRevenuePathLifecycle(lifecycle, healthy, '2026-08-31T12:10:00.000Z');
  const recovered = lifecycle;
  lifecycle = advanceRevenuePathLifecycle(lifecycle, broken, '2026-08-31T12:03:00.000Z');
  assert.deepEqual(lifecycle, recovered);
  assert.equal(lifecycle.exposureDurationMs, 10 * 60 * 1000);
});
