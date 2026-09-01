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
  const independentControls = new Map();

  for (const observation of observations) {
    if (!observation || observation.scopeId !== scopeId) continue;
    if (observation.state !== 'HEALTHY') continue;
    if (observation.geoProvenance !== 'TRUSTED_RUNTIME_VANTAGE') continue;
    if (typeof observation.geo !== 'string' || observation.geo === 'UNKNOWN') continue;
    if (!validObservedAt(observation.observedAt, nowMs, maxAgeMs)) continue;

    const observedGeo = observation.geo.toUpperCase();
    const exactTargetOtherGeo = observation.target === target && observedGeo !== normalizedGeo;
    const sameGeoMirror = Boolean(controlGroup) &&
      observation.controlGroup === controlGroup &&
      observation.target !== target &&
      observedGeo === normalizedGeo;

    if (!exactTargetOtherGeo && !sameGeoMirror) continue;

    const relation = exactTargetOtherGeo ? 'same-target-other-geo' : 'same-group-mirror';
    const independenceKey = exactTargetOtherGeo
      ? `${relation}:${observedGeo}`
      : `${relation}:${observation.target}:${observedGeo}`;
    const candidate = {
      target: observation.target,
      geo: observedGeo,
      state: 'HEALTHY',
      observedAt: observation.observedAt,
      provenance: 'Observed',
      geoProvenance: observation.geoProvenance,
      relation
    };
    const current = independentControls.get(independenceKey);
    if (!current || new Date(candidate.observedAt).getTime() > new Date(current.observedAt).getTime()) {
      independentControls.set(independenceKey, candidate);
    }
  }

  return [...independentControls.values()];
}
