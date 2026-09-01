import test from 'node:test';
import assert from 'node:assert/strict';
import { bindTrustedProbeVantage } from '../src/probe-vantage.js';

test('caller-supplied geo and platform region cannot become observed execution vantage', () => {
  const result = bindTrustedProbeVantage({ target: 'https://example.com', geo: 'DE' }, { VERCEL_REGION: 'iad1' });
  assert.equal(result.requestedGeo, 'DE');
  assert.equal(result.trustedGeo, 'UNKNOWN');
  assert.equal(result.executionRegion, 'IAD1');
  assert.equal(result.payload.geo, 'UNKNOWN');
  assert.equal(result.geoMatch, false);
  assert.equal(result.geoProvenance, 'Not observable externally');
});

test('explicit trusted probe geo is observed independently from platform region', () => {
  const result = bindTrustedProbeVantage({ geo: 'US-VA' }, { RADAR_PROBE_GEO: 'US-VA', VERCEL_REGION: 'iad1' });
  assert.equal(result.requestedGeo, 'US-VA');
  assert.equal(result.trustedGeo, 'US-VA');
  assert.equal(result.executionRegion, 'IAD1');
  assert.equal(result.payload.geo, 'US-VA');
  assert.equal(result.geoMatch, true);
  assert.equal(result.geoProvenance, 'TRUSTED_RUNTIME_VANTAGE');
});

test('missing trusted runtime vantage fails closed to UNKNOWN', () => {
  const result = bindTrustedProbeVantage({ geo: 'BR' }, {});
  assert.equal(result.requestedGeo, 'BR');
  assert.equal(result.payload.geo, 'UNKNOWN');
  assert.equal(result.geoProvenance, 'Not observable externally');
});

test('invalid trusted runtime label cannot be promoted to observed geo', () => {
  const result = bindTrustedProbeVantage({ geo: 'GB' }, { RADAR_PROBE_GEO: 'not valid geo label!' });
  assert.equal(result.payload.geo, 'UNKNOWN');
  assert.equal(result.geoProvenance, 'Not observable externally');
});
