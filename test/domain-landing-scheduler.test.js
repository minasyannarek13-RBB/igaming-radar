import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDomainLandingTarget } from '../src/domain-landing-target-store.js';
import { runDomainLandingBatch } from '../src/domain-landing-scheduler.js';
import { bindTrustedProbeVantage } from '../src/probe-vantage.js';

test('normalizes durable target config without treating requested GEO as observed GEO', () => {
  const record = normalizeDomainLandingTarget({
    scopeId: 'tenant-a', target: 'https://example.com/path#fragment', requestedGeo: 'de', recoveryConfirmations: 3,
    config: { ctaMarkers: ['Deposit', 'Play now'], errorMarkers: ['temporarily unavailable'], challengeMarkers: ['checking your browser'], criticalAssetUrls: ['https://cdn.example.com/app.js#v1'], ctaCritical: true }
  }, { now: () => new Date('2026-09-01T03:00:00Z') });
  assert.equal(record.scopeId, 'tenant-a'); assert.equal(record.target, 'https://example.com/path'); assert.equal(record.requestedGeo, 'DE'); assert.equal(record.recoveryConfirmations, 3); assert.equal(record.enabled, true); assert.equal(record.lastRunAt, null);
  assert.deepEqual(record.config, { ctaMarkers: ['Deposit', 'Play now'], errorMarkers: ['temporarily unavailable'], challengeMarkers: ['checking your browser'], criticalAssetUrls: ['https://cdn.example.com/app.js'], ctaCritical: true, controlGroup: null });
  assert.match(record.id, /^[a-f0-9]{64}$/);
});

test('rejects non-http target and critical-asset configuration', () => {
  assert.throws(() => normalizeDomainLandingTarget({ scopeId: 'tenant-a', target: 'file:///etc/passwd' }), /INVALID_TARGET_SCHEME/);
  assert.throws(() => normalizeDomainLandingTarget({ scopeId: 'tenant-a', target: 'https://example.com/', config: { criticalAssetUrls: ['file:///etc/passwd'] } }), /INVALID_TARGET_SCHEME/);
});

test('trusted vantage matches only explicit RADAR_PROBE_GEO and keeps execution region separate', () => {
  const matched = bindTrustedProbeVantage({ requestedGeo: 'DE', geo: 'DE' }, { RADAR_PROBE_GEO: 'de', VERCEL_REGION: 'fra1' });
  assert.equal(matched.requestedGeo, 'DE'); assert.equal(matched.trustedGeo, 'DE'); assert.equal(matched.executionRegion, 'FRA1'); assert.equal(matched.geoMatch, true); assert.equal(matched.payload.geo, 'DE');
  const unmatched = bindTrustedProbeVantage({ requestedGeo: 'US', geo: 'US' }, { RADAR_PROBE_GEO: 'de', VERCEL_REGION: 'fra1' });
  assert.equal(unmatched.trustedGeo, 'DE'); assert.equal(unmatched.geoMatch, false);
});

test('batch passes persisted probe config only through matching trusted vantage', async () => {
  const config = { ctaMarkers: ['Deposit'], errorMarkers: ['temporarily unavailable'], challengeMarkers: [], criticalAssetUrls: ['https://cdn.example.com/app.js'], ctaCritical: true };
  const targets = [
    { id: 'a', scopeId: 'tenant-a', target: 'https://a.example/', requestedGeo: 'DE', enabled: true, recoveryConfirmations: 2, config },
    { id: 'b', scopeId: 'tenant-a', target: 'https://b.example/', requestedGeo: 'US', enabled: true, recoveryConfirmations: 2, config }
  ];
  const marks = []; const probed = [];
  const targetStore = { async list() { return targets; }, async markRun(id, value) { marks.push({ id, ...value }); } };
  const lifecycleStore = { async get() { return null; }, async compareAndSet() { return { version: 1, lifecycle: {} }; } };
  const runCycle = async (input) => { probed.push({ target: input.target, config: input.config }); return { geo: input.geo, lifecycle: { state: 'HEALTHY' }, alert: null, probe: { state: 'HEALTHY' } }; };
  const result = await runDomainLandingBatch({ targetStore, lifecycleStore, env: { RADAR_PROBE_GEO: 'DE', VERCEL_REGION: 'FRA1' }, runCycle, now: () => new Date('2026-09-01T03:05:00Z') });
  assert.equal(result.attempted, 2); assert.equal(result.succeeded, 1); assert.equal(result.failed, 1); assert.equal(result.results[0].requestedGeo, 'DE'); assert.equal(result.results[0].observedGeo, 'DE'); assert.equal(result.results[0].executionRegion, 'FRA1'); assert.equal(result.results[1].requestedGeo, 'US'); assert.equal(result.results[1].observedGeo, 'DE'); assert.equal(result.results[1].state, 'NOT_OBSERVABLE'); assert.equal(result.results[1].error, 'GEO_VANTAGE_UNAVAILABLE');
  assert.deepEqual(probed, [{ target: 'https://a.example/', config }]); assert.deepEqual(marks.map((x) => [x.id, x.status]), [['a', 'SUCCESS'], ['b', 'FAILED']]); assert.equal(result.roiProof.savedGgr, null);
});

test('batch injects only fresh trusted related controls and persists current observation', async () => {
  const config = { controlGroup: 'operator-main' };
  const target = { id: 'a', scopeId: 'tenant-a', target: 'https://a.example/', requestedGeo: 'DE', enabled: true, recoveryConfirmations: 2, config };
  const recorded = []; let injected;
  const targetStore = { async list() { return [target]; }, async markRun() {} };
  const lifecycleStore = {
    async get() { return null; }, async compareAndSet() { return { version: 1, lifecycle: {} }; },
    async listObservations() { return [
      { scopeId: 'tenant-a', target: 'https://mirror.example/', geo: 'DE', state: 'HEALTHY', observedAt: '2026-09-01T03:04:00Z', geoProvenance: 'TRUSTED_RUNTIME_VANTAGE', controlGroup: 'operator-main' },
      { scopeId: 'tenant-a', target: 'https://a.example/', geo: 'US', state: 'HEALTHY', observedAt: '2026-09-01T03:03:00Z', geoProvenance: 'TRUSTED_RUNTIME_VANTAGE', controlGroup: null },
      { scopeId: 'tenant-a', target: 'https://evil.example/', geo: 'DE', state: 'HEALTHY', observedAt: '2026-09-01T03:04:00Z', geoProvenance: 'CALLER_ASSERTED', controlGroup: 'operator-main' },
      { scopeId: 'tenant-a', target: 'https://stale.example/', geo: 'DE', state: 'HEALTHY', observedAt: '2026-09-01T02:00:00Z', geoProvenance: 'TRUSTED_RUNTIME_VANTAGE', controlGroup: 'operator-main' }
    ]; },
    async recordObservation(value) { recorded.push(value); }
  };
  const runCycle = async (input, options) => { injected = options.trustedControls; return { geo: 'DE', lifecycle: { state: 'BROKEN' }, alert: { event: 'INCIDENT_OPENED' }, probe: { target: input.target, state: 'BROKEN', observedAt: '2026-09-01T03:05:00Z' } }; };
  const result = await runDomainLandingBatch({ targetStore, lifecycleStore, env: { RADAR_PROBE_GEO: 'DE', VERCEL_REGION: 'FRA1' }, runCycle, now: () => new Date('2026-09-01T03:05:00Z') });
  assert.equal(result.results[0].trustedControlCount, 2);
  assert.deepEqual(injected.map((x) => [x.target, x.geo, x.relation]), [['https://mirror.example/', 'DE', 'same-group-mirror'], ['https://a.example/', 'US', 'same-target-other-geo']]);
  assert.equal(recorded.length, 1); assert.equal(recorded[0].geoProvenance, 'TRUSTED_RUNTIME_VANTAGE'); assert.equal(recorded[0].controlGroup, 'operator-main');
});
