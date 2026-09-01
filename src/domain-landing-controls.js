const DEFAULT_MAX_AGE_MS = 15 * 60 * 1000;

function validObservedAt(value, nowMs, maxAgeMs) {
  const observedMs = new Date(value).getTime();
  return Number.isFinite(observedMs) && observedMs <= nowMs && nowMs - observedMs <= maxAgeMs;
}

export function assembleTrustedDomainLandingControls({
  observations,
  scopeId,
  target,
  geo,
  controlGroup = null,
  now = new Date(),
  maxAgeMs = DEFAULT_MAX_AGE_MS
} = {}) {
  if (!Array.isArray(observations)) return [];
  const nowMs = new Date(now).getTime();
  if (!Number.isFinite(nowMs) || !Number.isFinite(maxAgeMs) || maxAgeMs <= 0) return [];

  const normalizedGeo = typeof geo === 'string' ? geo.toUpperCase() : 'UNKNOWN';
  return observations.flatMap((observation) => {
    if (!observation || observation.scopeId !== scopeId) return [];
    if (observation.state !== 'HEALTHY') return [];
    if (observation.geoProvenance !== 'TRUSTED_RUNTIME_VANTAGE') return [];
    if (typeof observation.geo !== 'string' || observation.geo === 'UNKNOWN') return [];
    if (!validObservedAt(observation.observedAt, nowMs, maxAgeMs)) return [];

    const observedGeo = observation.geo.toUpperCase();
    const exactTargetOtherGeo = observation.target === target && observedGeo !== normalizedGeo;
    const sameGeoMirror = Boolean(controlGroup) &&
      observation.controlGroup === controlGroup &&
      observation.target !== target &&
      observedGeo === normalizedGeo;

    if (!exactTargetOtherGeo && !sameGeoMirror) return [];
    return [{
      target: observation.target,
      geo: observedGeo,
      state: 'HEALTHY',
      observedAt: observation.observedAt,
      provenance: 'Observed',
      geoProvenance: observation.geoProvenance,
      relation: exactTargetOtherGeo ? 'same-target-other-geo' : 'same-group-mirror'
    }];
  });
}
