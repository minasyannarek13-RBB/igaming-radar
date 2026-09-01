function cleanLabel(value) {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim().toUpperCase();
  return cleaned && /^[A-Z0-9_-]{2,16}$/.test(cleaned) ? cleaned : null;
}

export function bindTrustedProbeVantage(payload, env = process.env) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const requestedGeo = cleanLabel(input.requestedGeo) || cleanLabel(input.geo) || 'UNKNOWN';
  const trustedGeo = cleanLabel(env?.RADAR_PROBE_GEO) || 'UNKNOWN';
  const executionRegion = cleanLabel(env?.VERCEL_REGION) || 'UNKNOWN';
  const geoMatch = requestedGeo === 'UNKNOWN'
    ? trustedGeo !== 'UNKNOWN'
    : trustedGeo !== 'UNKNOWN' && trustedGeo === requestedGeo;

  return {
    payload: { ...input, geo: trustedGeo },
    requestedGeo,
    trustedGeo,
    executionRegion,
    geoMatch,
    geoProvenance: trustedGeo === 'UNKNOWN'
      ? 'Not observable externally'
      : 'TRUSTED_RUNTIME_VANTAGE'
  };
}
