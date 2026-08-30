import test from 'node:test';
import assert from 'node:assert/strict';
import { domainLandingFixtures } from './fixtures/revenue-path-domain-landing.js';

const STATES = new Set(['HEALTHY', 'DEGRADED', 'BROKEN', 'NOT_OBSERVABLE']);

for (const fixture of domainLandingFixtures) {
  test(`revenue-path fixture contract: ${fixture.id}`, () => {
    assert.match(fixture.id, /^[a-z0-9-]+$/);
    assert.ok(fixture.target.startsWith('https://'));
    assert.ok(fixture.geo);
    assert.ok(fixture.observations && typeof fixture.observations === 'object');
    assert.ok(STATES.has(fixture.expected.state));
    assert.equal(fixture.expected.attributable, false, 'fixture must not fabricate root-cause attribution');
  });
}

test('fixture set covers the Domain/Landing release scenarios exactly once', () => {
  const required = [
    'global-outage',
    'geo-local-failure',
    'blocked-mirror',
    'redirect-loop',
    'soft-200-error-page',
    'broken-cta',
    'analytics-cdn-noise',
    'healthy-control'
  ];
  assert.deepEqual(domainLandingFixtures.map((f) => f.id).sort(), required.sort());
});

test('analytics/CDN noise cannot become a dependency edge', () => {
  const fixture = domainLandingFixtures.find((f) => f.id === 'analytics-cdn-noise');
  assert.equal(fixture.expected.state, 'HEALTHY');
  assert.equal(fixture.expected.dependencyEdges, 0);
});

test('blocked mirror fixture does not claim a blocking cause', () => {
  const fixture = domainLandingFixtures.find((f) => f.id === 'blocked-mirror');
  assert.equal(fixture.expected.scope, 'mirror-only-observed');
  assert.equal(fixture.expected.cause, 'NOT_OBSERVABLE');
});

test('GEO-local fixture requires healthy controls outside affected GEO', () => {
  const fixture = domainLandingFixtures.find((f) => f.id === 'geo-local-failure');
  assert.ok(fixture.controls.length >= 2);
  assert.ok(fixture.controls.every((control) => control.state === 'HEALTHY'));
  assert.ok(fixture.controls.every((control) => control.geo !== fixture.geo));
});
