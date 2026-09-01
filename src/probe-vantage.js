function cleanLabel(value) {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim().toUpperCase();
  return cleaned && /^[A-Z0-9_-]{2,16}$/.test(cleaned) ? cleaned : null;
}

export function bindTrustedProbeVantage(payload, env = process.env) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const requestedGeo = cleanLabel(input.geo);
  const trustedGeo = cleanLabel(env?.RADAR_PROBE_GEO) || cleanLabel(env?.VERCEL_REGION) || 'UNKNOWN';

  return {
    payload: { ...input, geo: trustedGeo },
    requestedGeo,
    trustedGeo,
    geoProvenance: trustedGeo === 'UNKNOWN' ? 'Not observable externally' : 'Observed'
  };
}
