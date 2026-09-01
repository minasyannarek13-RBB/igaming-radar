import test from 'node:test';
import assert from 'node:assert/strict';
import { bindTrustedProbeVantage } from '../src/probe-vantage.js';

test('caller-supplied geo cannot become observed execution vantage', () => {
  const result = bindTrustedProbeVantage({ target: 'https://example.com', geo: 'DE' }, { VERCEL_REGION: 'iad1' });
  assert.equal(result.requestedGeo, 'DE');
  assert.equal(result.trustedGeo, 'IAD1');
  assert.equal(result.payload.geo, 'IAD1');
  assert.equal(result.geoProvenance, 'Observed');
});

test('explicit trusted probe geo overrides platform region', () => {
  const result = bindTrustedProbeVantage({ geo: 'US' }, { RADAR_PROBE_GEO: 'US-VA', VERCEL_REGION: 'iad1' });
  assert.equal(result.requestedGeo, 'US');
  assert.equal(result.payload.geo, 'US-VA');
  assert.equal(result.geoProvenance, 'Observed');
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
