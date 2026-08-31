const ALERTABLE_STATES = new Set(['BROKEN', 'DEGRADED']);

function iso(value, field) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) throw new Error(`invalid ${field}`);
  return new Date(time).toISOString();
}

function requireEvidence(classified) {
  const evidence = classified?.evidence;
  if (!evidence || typeof evidence !== 'object') throw new Error('classification evidence required');
  if (!evidence.evidenceClass) throw new Error('classification evidenceClass required');
  return evidence;
}

/**
 * Builds a transport-neutral alert payload from an already-classified Revenue Path
 * observation and persisted lifecycle. This function does not infer root cause,
 * dependencies, revenue loss, or saved GGR.
 */
export function buildRevenuePathAlert(input) {
  const classified = input?.classified;
  const lifecycle = input?.lifecycle;
  if (!classified || !lifecycle) throw new Error('classified and lifecycle required');

  const evidence = requireEvidence(classified);
  const target = input?.target;
  const path = input?.path ?? 'DOMAIN/LANDING';
  const observedAt = iso(input?.observedAt ?? lifecycle.lastObservedAt, 'observedAt');
  const lastObservedAt = lifecycle.lastObservedAt ? iso(lifecycle.lastObservedAt, 'lastObservedAt') : null;

  if (!target || typeof target !== 'string') throw new Error('target required');
  if (!lastObservedAt || observedAt !== lastObservedAt) {
    throw new Error('alert must be built from latest persisted observation');
  }

  const geo = evidence.geo ?? input?.geo ?? 'UNKNOWN';
  const base = {
    contract: 'revenue-path-alert/v1',
    path,
    target,
    geo,
    observedAt,
    state: lifecycle.state,
    scope: classified.scope ?? 'none',
    confidence: input?.confidence ?? 'GUARDED',
    evidenceClass: evidence.evidenceClass,
    evidence,
    attribution: classified.attributable === true && Number(classified.dependencyEdges ?? 0) > 0
      ? {
          status: 'OBSERVED_OR_SUPPORTED',
          cause: classified.cause ?? 'NOT_OBSERVABLE',
          dependencyEdges: Number(classified.dependencyEdges)
        }
      : {
          status: 'NOT_OBSERVABLE_EXTERNALLY',
          cause: 'NOT_OBSERVABLE',
          dependencyEdges: 0
        },
    roiProof: {
      status: 'NOT_CLAIMED',
      savedGgr: null,
      savedRevenue: null
    }
  };

  if (lifecycle.recoveredAt && !lifecycle.incidentOpen && lifecycle.state === 'HEALTHY') {
    const recoveredAt = iso(lifecycle.recoveredAt, 'recoveredAt');
    if (recoveredAt !== observedAt) return null;
    return {
      ...base,
      event: 'RECOVERY',
      state: 'HEALTHY',
      firstDetected: lifecycle.firstDetected ? iso(lifecycle.firstDetected, 'firstDetected') : null,
      recoveredAt,
      exposureDurationMs: Math.max(0, Number(lifecycle.exposureDurationMs ?? 0))
    };
  }

  if (!lifecycle.incidentOpen || !ALERTABLE_STATES.has(lifecycle.state)) return null;
  if (!ALERTABLE_STATES.has(classified.state)) return null;

  const firstDetected = iso(lifecycle.firstDetected, 'firstDetected');
  return {
    ...base,
    event: firstDetected === observedAt ? 'INCIDENT_OPEN' : 'INCIDENT_UPDATE',
    firstDetected,
    recoveredAt: null,
    exposureDurationMs: Math.max(0, Number(lifecycle.exposureDurationMs ?? 0))
  };
}
