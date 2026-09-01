import test from 'node:test';
import assert from 'node:assert/strict';
import { assembleTrustedDomainLandingControls } from '../src/domain-landing-controls.js';
import { classifyDomainLanding } from '../src/revenue-path.js';

const now = new Date('2026-09-01T18:00:00.000Z');

function healthyObservation({ geo, observedAt, target = 'https://operator.example', controlGroup = null }) {
  return {
    scopeId: 'tenant-a',
    target,
    geo,
    state: 'HEALTHY',
    observedAt,
    geoProvenance: 'TRUSTED_RUNTIME_VANTAGE',
    controlGroup
  };
}

test('repeated HEALTHY history from one other GEO counts as one independent control', () => {
  const controls = assembleTrustedDomainLandingControls({
    observations: [
      healthyObservation({ geo: 'FR', observedAt: '2026-09-01T17:59:00.000Z' }),
      healthyObservation({ geo: 'FR', observedAt: '2026-09-01T17:58:00.000Z' })
    ],
    scopeId: 'tenant-a',
    target: 'https://operator.example',
    geo: 'DE',
    now
  });

  assert.equal(controls.length, 1);
  assert.equal(controls[0].geo, 'FR');
  assert.equal(controls[0].observedAt, '2026-09-01T17:59:00.000Z');

  const classified = classifyDomainLanding({
    geo: 'DE',
    observations: {
      probeContext: 'automated',
      http: 451,
      page: 'unavailable',
      accessConfirmations: 2,
      accessCorroborated: true
    },
    controls
  });

  assert.equal(classified.state, 'NOT_OBSERVABLE');
  assert.equal(classified.scope, 'geo-ambiguous');
  assert.equal(classified.dependencyEdges, 0);
});

test('two distinct trusted other GEO controls retain the existing geo-local threshold', () => {
  const controls = assembleTrustedDomainLandingControls({
    observations: [
      healthyObservation({ geo: 'FR', observedAt: '2026-09-01T17:59:00.000Z' }),
      healthyObservation({ geo: 'NL', observedAt: '2026-09-01T17:58:30.000Z' }),
      healthyObservation({ geo: 'FR', observedAt: '2026-09-01T17:58:00.000Z' })
    ],
    scopeId: 'tenant-a',
    target: 'https://operator.example',
    geo: 'DE',
    now
  });

  assert.equal(controls.length, 2);
  assert.deepEqual(new Set(controls.map((control) => control.geo)), new Set(['FR', 'NL']));

  const classified = classifyDomainLanding({
    geo: 'DE',
    observations: {
      probeContext: 'automated',
      http: 451,
      page: 'unavailable',
      accessConfirmations: 2,
      accessCorroborated: true
    },
    controls
  });

  assert.equal(classified.state, 'BROKEN');
  assert.equal(classified.scope, 'geo-local-observed');
  assert.equal(classified.attributable, false);
  assert.equal(classified.dependencyEdges, 0);
});

test('same-GEO mirror controls stay separate from independent other-GEO controls', () => {
  const controls = assembleTrustedDomainLandingControls({
    observations: [
      healthyObservation({ geo: 'DE', target: 'https://mirror.example', controlGroup: 'brand-a', observedAt: '2026-09-01T17:59:00.000Z' }),
      healthyObservation({ geo: 'DE', target: 'https://mirror.example', controlGroup: 'brand-a', observedAt: '2026-09-01T17:58:00.000Z' }),
      healthyObservation({ geo: 'FR', observedAt: '2026-09-01T17:57:00.000Z' })
    ],
    scopeId: 'tenant-a',
    target: 'https://operator.example',
    geo: 'DE',
    controlGroup: 'brand-a',
    now
  });

  assert.equal(controls.length, 2);
  assert.equal(controls.filter((control) => control.relation === 'same-group-mirror').length, 1);
  assert.equal(controls.filter((control) => control.relation === 'same-target-other-geo').length, 1);
});
