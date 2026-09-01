import test from 'node:test';
import assert from 'node:assert/strict';
import { domainLandingFixtures } from './fixtures/revenue-path-domain-landing.js';
import {
  advanceRevenuePathLifecycle,
  classifyDomainLanding,
  initialRevenuePathLifecycle
} from '../src/revenue-path.js';

function fixture(id) {
  const found = domainLandingFixtures.find((item) => item.id === id);
  assert.ok(found, `missing fixture ${id}`);
  return found;
}

function classify(id, overrides = {}) {
  const item = fixture(id);
  return classifyDomainLanding({ ...item, ...overrides });
}

test('global DNS failure is BROKEN without invented attribution', () => {
  const result = classify('global-outage');
  assert.equal(result.state, 'BROKEN');
  assert.equal(result.scope, 'global-observed');
  assert.equal(result.attributable, false);
  assert.equal(result.cause, 'NOT_OBSERVABLE');
});

test('GEO-local failure requires healthy independent GEO controls', () => {
  const result = classify('geo-local-failure');
  assert.equal(result.state, 'BROKEN');
  assert.equal(result.scope, 'geo-local-observed');

  const ambiguous = classify('geo-local-failure', {
    controls: [{ geo: 'DE', state: 'HEALTHY' }]
  });
  assert.equal(ambiguous.state, 'NOT_OBSERVABLE');
  assert.equal(ambiguous.scope, 'geo-ambiguous');
});

test('mirror 403 is observed as mirror-only but cause remains NOT_OBSERVABLE', () => {
  const result = classify('blocked-mirror');
  assert.equal(result.state, 'BROKEN');
  assert.equal(result.scope, 'mirror-only-observed');
  assert.equal(result.cause, 'NOT_OBSERVABLE');
  assert.equal(result.attributable, false);
});

test('redirect loop and soft-200 error template are BROKEN', () => {
  assert.equal(classify('redirect-loop').state, 'BROKEN');
  assert.equal(classify('soft-200-error-page').state, 'BROKEN');
});

test('broken CTA is DEGRADED only when configured as conversion-critical', () => {
  const unconfigured = classify('broken-cta', { config: {} });
  assert.equal(unconfigured.state, 'HEALTHY');

  const configured = classify('broken-cta', { config: { ctaCritical: true } });
  assert.equal(configured.state, 'DEGRADED');
  assert.equal(configured.scope, 'conversion-path');
});

test('unrelated analytics/CDN failure remains HEALTHY and creates no dependency edge', () => {
  const result = classify('analytics-cdn-noise');
  assert.equal(result.state, 'HEALTHY');
  assert.equal(result.dependencyEdges, 0);
  assert.equal(result.attributable, false);
});

test('bot/WAF challenge from automated probe is NOT_OBSERVABLE', () => {
  const result = classify('waf-bot-ambiguous');
  assert.equal(result.state, 'NOT_OBSERVABLE');
  assert.equal(result.scope, 'probe-ambiguous');
  assert.equal(result.cause, 'NOT_OBSERVABLE');
});

test('classification preserves evidence provenance', () => {
  const result = classifyDomainLanding({
    ...fixture('healthy-control'),
    evidenceClass: 'LIVE_OBSERVED'
  });
  assert.equal(result.evidence.evidenceClass, 'LIVE_OBSERVED');
  assert.equal(result.evidence.geo, 'DE');
  assert.deepEqual(result.evidence.observations, fixture('healthy-control').observations);
});

test('single automated DNS failure with healthy controls is NOT_OBSERVABLE and preserves evidence', () => {
  const observations = { dns: 'fail', probeContext: 'automated' };
  const controls = [
    { geo: 'NL', state: 'HEALTHY' },
    { geo: 'GB', state: 'HEALTHY' }
  ];
  const result = classifyDomainLanding({
    geo: 'DE',
    evidenceClass: 'LIVE_OBSERVED',
    observations,
    controls
  });

  assert.equal(result.state, 'NOT_OBSERVABLE');
  assert.equal(result.scope, 'dns-probe-ambiguous');
  assert.equal(result.attributable, false);
  assert.equal(result.cause, 'NOT_OBSERVABLE');
  assert.deepEqual(result.evidence.observations, observations);
  assert.deepEqual(result.evidence.controls, controls);
});

test('corroborated repeated DNS failure may be BROKEN without invented cause', () => {
  const result = classifyDomainLanding({
    geo: 'DE',
    evidenceClass: 'LIVE_OBSERVED',
    observations: {
      dns: 'fail',
      probeContext: 'automated',
      dnsConfirmations: 2
    }
  });

  assert.equal(result.state, 'BROKEN');
  assert.equal(result.scope, 'target-corroborated');
  assert.equal(result.attributable, false);
  assert.equal(result.cause, 'NOT_OBSERVABLE');
});

test('multi-vantage DNS failure remains BROKEN without claiming blocking cause', () => {
  const result = classifyDomainLanding({
    geo: 'MULTI',
    evidenceClass: 'LIVE_OBSERVED',
    observations: {
      dns: 'fail',
      probeContext: 'automated'
    }
  });

  assert.equal(result.state, 'BROKEN');
  assert.equal(result.scope, 'global-observed');
  assert.equal(result.attributable, false);
  assert.equal(result.cause, 'NOT_OBSERVABLE');
});

test('single automated TLS failure with healthy controls is NOT_OBSERVABLE and preserves evidence', () => {
  const observations = { dns: 'ok', tls: 'fail', probeContext: 'automated' };
  const controls = [
    { geo: 'GE', state: 'HEALTHY' },
    { geo: 'DE', state: 'HEALTHY' }
  ];
  const result = classifyDomainLanding({
    geo: 'AM',
    evidenceClass: 'LIVE_OBSERVED',
    observations,
    controls
  });

  assert.equal(result.state, 'NOT_OBSERVABLE');
  assert.equal(result.scope, 'tls-probe-ambiguous');
  assert.equal(result.attributable, false);
  assert.equal(result.cause, 'NOT_OBSERVABLE');
  assert.deepEqual(result.evidence.observations, observations);
  assert.deepEqual(result.evidence.controls, controls);
});

test('corroborated repeated TLS failure may be BROKEN without invented cause', () => {
  const result = classifyDomainLanding({
    geo: 'AM',
    evidenceClass: 'LIVE_OBSERVED',
    observations: {
      dns: 'ok',
      tls: 'fail',
      probeContext: 'automated',
      tlsConfirmations: 2
    }
  });

  assert.equal(result.state, 'BROKEN');
  assert.equal(result.scope, 'target-corroborated');
  assert.equal(result.attributable, false);
  assert.equal(result.cause, 'NOT_OBSERVABLE');
});

test('multi-vantage TLS failure may be BROKEN without claiming certificate/provider cause', () => {
  const result = classifyDomainLanding({
    geo: 'MULTI',
    evidenceClass: 'LIVE_OBSERVED',
    observations: {
      dns: 'ok',
      tls: 'fail',
      probeContext: 'automated'
    }
  });

  assert.equal(result.state, 'BROKEN');
  assert.equal(result.scope, 'global-observed');
  assert.equal(result.attributable, false);
  assert.equal(result.cause, 'NOT_OBSERVABLE');
});

test('firstDetected remains stable across repeated failing probes', () => {
  const broken = classify('global-outage');
  let lifecycle = initialRevenuePathLifecycle();
  lifecycle = advanceRevenuePathLifecycle(lifecycle, broken, '2026-08-30T10:00:00.000Z');
  lifecycle = advanceRevenuePathLifecycle(lifecycle, broken, '2026-08-30T10:05:00.000Z');

  assert.equal(lifecycle.firstDetected, '2026-08-30T10:00:00.000Z');
  assert.equal(lifecycle.incidentOpen, true);
  assert.equal(lifecycle.incidentOpenDurationMs, 5 * 60 * 1000);
  assert.equal(lifecycle.observedExposureUpperBoundMs, null);
});

test('recovery requires healthy hysteresis and separates confirmation duration from exposure bound', () => {
  const broken = classify('global-outage');
  const healthy = classify('healthy-control');
  let lifecycle = initialRevenuePathLifecycle();

  lifecycle = advanceRevenuePathLifecycle(lifecycle, broken, '2026-08-30T10:00:00.000Z');
  lifecycle = advanceRevenuePathLifecycle(lifecycle, healthy, '2026-08-30T10:10:00.000Z');
  assert.equal(lifecycle.incidentOpen, true);
  assert.equal(lifecycle.recoveredAt, null);
  assert.equal(lifecycle.observedExposureUpperBoundMs, 10 * 60 * 1000);

  lifecycle = advanceRevenuePathLifecycle(lifecycle, healthy, '2026-08-30T10:12:00.000Z');
  assert.equal(lifecycle.incidentOpen, false);
  assert.equal(lifecycle.state, 'HEALTHY');
  assert.equal(lifecycle.recoveredAt, '2026-08-30T10:12:00.000Z');
  assert.equal(lifecycle.incidentOpenDurationMs, 12 * 60 * 1000);
  assert.equal(lifecycle.observedExposureUpperBoundMs, 10 * 60 * 1000);
});

test('NOT_OBSERVABLE does not count as recovery proof', () => {
  const broken = classify('global-outage');
  const ambiguous = classify('waf-bot-ambiguous');
  let lifecycle = initialRevenuePathLifecycle();

  lifecycle = advanceRevenuePathLifecycle(lifecycle, broken, '2026-08-30T10:00:00.000Z');
  lifecycle = advanceRevenuePathLifecycle(lifecycle, ambiguous, '2026-08-30T10:05:00.000Z');

  assert.equal(lifecycle.incidentOpen, true);
  assert.equal(lifecycle.state, 'BROKEN');
  assert.equal(lifecycle.healthyConfirmations, 0);
  assert.equal(lifecycle.recoveredAt, null);
  assert.equal(lifecycle.observedExposureUpperBoundMs, null);
});

test('delayed BROKEN cannot move lifecycle event-time or incident-open duration backward', () => {
  const broken = classify('global-outage');
  let lifecycle = initialRevenuePathLifecycle();
  lifecycle = advanceRevenuePathLifecycle(lifecycle, broken, '2026-08-30T10:00:00.000Z');
  lifecycle = advanceRevenuePathLifecycle(lifecycle, broken, '2026-08-30T10:05:00.000Z');
  const beforeDelayed = lifecycle;

  lifecycle = advanceRevenuePathLifecycle(lifecycle, broken, '2026-08-30T10:02:00.000Z');

  assert.deepEqual(lifecycle, beforeDelayed);
  assert.equal(lifecycle.lastObservedAt, '2026-08-30T10:05:00.000Z');
  assert.equal(lifecycle.firstDetected, '2026-08-30T10:00:00.000Z');
  assert.equal(lifecycle.incidentOpenDurationMs, 5 * 60 * 1000);
});

test('delayed HEALTHY cannot enter recovery hysteresis', () => {
  const broken = classify('global-outage');
  const healthy = classify('healthy-control');
  let lifecycle = initialRevenuePathLifecycle();
  lifecycle = advanceRevenuePathLifecycle(lifecycle, broken, '2026-08-30T10:00:00.000Z');
  lifecycle = advanceRevenuePathLifecycle(lifecycle, broken, '2026-08-30T10:05:00.000Z');

  lifecycle = advanceRevenuePathLifecycle(lifecycle, healthy, '2026-08-30T10:02:00.000Z');

  assert.equal(lifecycle.incidentOpen, true);
  assert.equal(lifecycle.state, 'BROKEN');
  assert.equal(lifecycle.healthyConfirmations, 0);
  assert.equal(lifecycle.recoveryCandidateAt, null);
  assert.equal(lifecycle.lastObservedAt, '2026-08-30T10:05:00.000Z');
});

test('equal timestamp observation is idempotent first-write-wins', () => {
  const broken = classify('global-outage');
  const healthy = classify('healthy-control');
  let lifecycle = initialRevenuePathLifecycle();
  lifecycle = advanceRevenuePathLifecycle(lifecycle, broken, '2026-08-30T10:00:00.000Z');
  const firstWrite = lifecycle;

  lifecycle = advanceRevenuePathLifecycle(lifecycle, healthy, '2026-08-30T10:00:00.000Z');

  assert.deepEqual(lifecycle, firstWrite);
  assert.equal(lifecycle.incidentOpen, true);
  assert.equal(lifecycle.state, 'BROKEN');
  assert.equal(lifecycle.healthyConfirmations, 0);
  assert.equal(lifecycle.recoveredAt, null);
});
