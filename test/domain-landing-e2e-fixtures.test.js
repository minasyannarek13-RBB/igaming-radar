import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyDomainLanding, initialRevenuePathLifecycle, advanceRevenuePathLifecycle } from '../src/revenue-path.js';
import { domainLandingFixtures } from './fixtures/domain-landing-e2e.js';

for (const [name, fixture] of Object.entries(domainLandingFixtures)) {
  test(`Domain/Landing deterministic fixture: ${name}`, () => {
    const result = classifyDomainLanding({ ...fixture, evidenceClass: 'SYNTHETIC_TEST' });
    assert.equal(result.state, fixture.expected.state);
    assert.equal(result.scope, fixture.expected.scope);
    assert.equal(result.cause, 'NOT_OBSERVABLE');
    assert.equal(result.dependencyEdges, 0);
    assert.equal(result.evidence.evidenceClass, 'SYNTHETIC_TEST');
    assert.equal(result.evidence.geo, fixture.geo);
  });
}

test('Domain/Landing lifecycle keeps hysteresis and separates confirmed-open duration from exposure bound', () => {
  let lifecycle = initialRevenuePathLifecycle();
  lifecycle = advanceRevenuePathLifecycle(lifecycle, { state: 'BROKEN' }, '2026-08-31T18:00:00.000Z');
  assert.equal(lifecycle.incidentOpen, true);
  assert.equal(lifecycle.firstDetected, '2026-08-31T18:00:00.000Z');
  assert.equal(lifecycle.incidentOpenDurationMs, 0);
  assert.equal(lifecycle.observedExposureUpperBoundMs, null);

  lifecycle = advanceRevenuePathLifecycle(lifecycle, { state: 'NOT_OBSERVABLE' }, '2026-08-31T18:05:00.000Z');
  assert.equal(lifecycle.incidentOpen, true);
  assert.equal(lifecycle.state, 'BROKEN');
  assert.equal(lifecycle.recoveredAt, null);
  assert.equal(lifecycle.observedExposureUpperBoundMs, null);

  lifecycle = advanceRevenuePathLifecycle(lifecycle, { state: 'HEALTHY' }, '2026-08-31T18:10:00.000Z');
  assert.equal(lifecycle.incidentOpen, true);
  assert.equal(lifecycle.healthyConfirmations, 1);
  assert.equal(lifecycle.recoveredAt, null);
  assert.equal(lifecycle.recoveryCandidateAt, '2026-08-31T18:10:00.000Z');
  assert.equal(lifecycle.observedExposureUpperBoundMs, 10 * 60 * 1000);

  lifecycle = advanceRevenuePathLifecycle(lifecycle, { state: 'HEALTHY' }, '2026-08-31T18:15:00.000Z');
  assert.equal(lifecycle.incidentOpen, false);
  assert.equal(lifecycle.state, 'HEALTHY');
  assert.equal(lifecycle.recoveredAt, '2026-08-31T18:15:00.000Z');
  assert.equal(lifecycle.incidentOpenDurationMs, 15 * 60 * 1000);
  assert.equal(lifecycle.observedExposureUpperBoundMs, 10 * 60 * 1000);
  assert.equal('exposureDurationMs' in lifecycle, false);
});

test('delayed or duplicate observations cannot rewrite lifecycle timing', () => {
  let lifecycle = initialRevenuePathLifecycle();
  lifecycle = advanceRevenuePathLifecycle(lifecycle, { state: 'BROKEN' }, '2026-08-31T18:00:00.000Z');
  lifecycle = advanceRevenuePathLifecycle(lifecycle, { state: 'HEALTHY' }, '2026-08-31T18:10:00.000Z');
  const snapshot = lifecycle;
  lifecycle = advanceRevenuePathLifecycle(lifecycle, { state: 'HEALTHY' }, '2026-08-31T18:10:00.000Z');
  assert.deepEqual(lifecycle, snapshot);
  lifecycle = advanceRevenuePathLifecycle(lifecycle, { state: 'HEALTHY' }, '2026-08-31T18:09:00.000Z');
  assert.deepEqual(lifecycle, snapshot);
});
