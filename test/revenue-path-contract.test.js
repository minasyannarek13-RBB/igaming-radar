const test = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('./fixtures/revenue-path-domain-landing.json');

const STATES = new Set(['HEALTHY','DEGRADED','BROKEN','NOT_OBSERVABLE']);

function validateCase(c) {
  assert.ok(c.id);
  assert.ok(['DOMAIN','MIRROR','LANDING'].includes(c.assetType));
  assert.ok(c.geos && Object.keys(c.geos).length > 0);
  assert.ok(STATES.has(c.expected.state));
  assert.ok(c.expected.scope);
  assert.ok(c.expected.attribution);
  assert.equal(typeof c.expected.alert, 'boolean');
}

test('Domain/Landing E2E corpus contains all release-critical deterministic cases', () => {
  assert.equal(fixture.evidenceClass, 'SYNTHETIC_TEST');
  const ids = new Set(fixture.cases.map(c => c.id));
  for (const required of ['global-outage','geo-local-failure','blocked-mirror','redirect-loop','soft-200-error','broken-cta','analytics-cdn-noise','healthy-control']) {
    assert.ok(ids.has(required), `missing fixture: ${required}`);
  }
  fixture.cases.forEach(validateCase);
});

test('GEO-local cases cannot be represented as global failures', () => {
  for (const c of fixture.cases.filter(c => c.expected.scope === 'geo_local')) {
    assert.ok(Array.isArray(c.expected.affectedGeos) && c.expected.affectedGeos.length > 0);
    assert.notEqual(c.expected.scope, 'global');
  }
});

test('blocked mirror fixture forbids unsupported censorship attribution', () => {
  const c = fixture.cases.find(c => c.id === 'blocked-mirror');
  assert.equal(c.expected.attribution, 'NOT_OBSERVABLE');
  assert.equal(c.expected.mustNotClaim, 'regulator_or_isp_block_without_external_evidence');
});

test('analytics/CDN noise cannot degrade revenue path or create dependency edge', () => {
  const c = fixture.cases.find(c => c.id === 'analytics-cdn-noise');
  assert.equal(c.expected.state, 'HEALTHY');
  assert.equal(c.expected.alert, false);
  assert.equal(c.expected.mustNotCreateDependencyEdge, true);
});

test('healthy control remains alert-free', () => {
  const c = fixture.cases.find(c => c.id === 'healthy-control');
  assert.equal(c.expected.state, 'HEALTHY');
  assert.equal(c.expected.alert, false);
});
