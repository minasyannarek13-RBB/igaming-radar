const STATES = new Set(['HEALTHY', 'DEGRADED', 'BROKEN', 'NOT_OBSERVABLE']);

function healthyControl(control, affectedGeo) {
  return control?.state === 'HEALTHY' && control?.geo && control.geo !== affectedGeo;
}

export function classifyDomainLanding(input) {
  const observations = input?.observations ?? {};
  const controls = Array.isArray(input?.controls) ? input.controls : [];
  const config = input?.config ?? {};
  const geo = input?.geo ?? 'UNKNOWN';

  const result = {
    state: 'HEALTHY',
    scope: 'none',
    attributable: false,
    cause: 'NOT_OBSERVABLE',
    dependencyEdges: 0,
    evidence: {
      geo,
      observations,
      controls,
      evidenceClass: input?.evidenceClass ?? 'SYNTHETIC_TEST'
    }
  };

  if (
    observations.probeContext === 'automated' &&
    [403, 451].includes(observations.http)
  ) {
    const confirmations = Number(observations.accessConfirmations ?? 0);
    const corroborated = observations.accessCorroborated === true || confirmations >= 2;
    if (!corroborated) {
      return {
        ...result,
        state: 'NOT_OBSERVABLE',
        scope: observations.page === 'challenge' ? 'probe-ambiguous' : 'geo-ambiguous'
      };
    }
  }

  if (observations.dns === 'fail') {
    const confirmations = Number(observations.dnsConfirmations ?? 0);
    const corroborated = observations.dnsCorroborated === true || confirmations >= 2;

    if (geo === 'MULTI') return { ...result, state: 'BROKEN', scope: 'global-observed' };
    if (corroborated) return { ...result, state: 'BROKEN', scope: 'target-corroborated' };

    const independentHealthyControls = controls.filter((control) => healthyControl(control, geo));
    if (observations.probeContext === 'automated' || independentHealthyControls.length > 0) {
      return { ...result, state: 'NOT_OBSERVABLE', scope: 'dns-probe-ambiguous' };
    }
    return { ...result, state: 'NOT_OBSERVABLE', scope: 'dns-unconfirmed' };
  }

  if (observations.tls === 'fail') {
    const confirmations = Number(observations.tlsConfirmations ?? 0);
    const corroborated = observations.tlsCorroborated === true || confirmations >= 2;

    if (geo === 'MULTI') return { ...result, state: 'BROKEN', scope: 'global-observed' };
    if (corroborated) return { ...result, state: 'BROKEN', scope: 'target-corroborated' };

    const independentHealthyControls = controls.filter((control) => healthyControl(control, geo));
    if (observations.probeContext === 'automated' || independentHealthyControls.length > 0) {
      return { ...result, state: 'NOT_OBSERVABLE', scope: 'tls-probe-ambiguous' };
    }
    return { ...result, state: 'NOT_OBSERVABLE', scope: 'tls-unconfirmed' };
  }

  if (observations.redirect === 'loop') {
    return { ...result, state: 'BROKEN', scope: 'target' };
  }

  if (Number.isInteger(observations.http) && observations.http >= 500 && observations.http <= 599) {
    if (observations.probeContext === 'automated') {
      const confirmations = Number(observations.http5xxConfirmations ?? 0);
      const corroborated = observations.http5xxCorroborated === true || confirmations >= 2;
      if (!corroborated) return { ...result, state: 'NOT_OBSERVABLE', scope: 'http-5xx-probe-ambiguous' };
      return { ...result, state: 'BROKEN', scope: 'target-corroborated' };
    }
    return { ...result, state: 'BROKEN', scope: 'target-observed' };
  }

  if (observations.http === 200 && observations.page === 'error-template') {
    const confirmations = Number(observations.pageConfirmations ?? 0);
    const corroborated = observations.pageCorroborated === true || confirmations >= 2;

    if (geo === 'MULTI') return { ...result, state: 'BROKEN', scope: 'landing-global-observed' };
    if (corroborated) return { ...result, state: 'BROKEN', scope: 'landing-corroborated' };

    const independentHealthyControls = controls.filter((control) => healthyControl(control, geo));
    if (observations.probeContext === 'automated' || independentHealthyControls.length > 0) {
      return { ...result, state: 'NOT_OBSERVABLE', scope: 'soft-200-probe-ambiguous' };
    }
    return { ...result, state: 'BROKEN', scope: 'landing' };
  }

  if ([403, 451].includes(observations.http) && observations.page === 'unavailable') {
    const mirrorHealthy = controls.some(
      (control) => control?.target && control.geo === geo && control.state === 'HEALTHY'
    );
    if (mirrorHealthy) return { ...result, state: 'BROKEN', scope: 'mirror-only-observed' };

    const independentGeoControls = controls.filter((control) => healthyControl(control, geo));
    if (independentGeoControls.length >= 2) {
      return { ...result, state: 'BROKEN', scope: 'geo-local-observed' };
    }
    return { ...result, state: 'NOT_OBSERVABLE', scope: 'geo-ambiguous' };
  }

  if (observations.criticalAssets === 'broken') {
    if (observations.probeContext === 'automated') {
      const confirmations = Number(observations.criticalAssetConfirmations ?? 0);
      const corroborated = observations.criticalAssetCorroborated === true || confirmations >= 2;
      if (!corroborated) return { ...result, state: 'NOT_OBSERVABLE', scope: 'landing-assets-probe-ambiguous' };
    }
    return { ...result, state: 'DEGRADED', scope: 'landing-assets' };
  }

  if ((observations.cta === 'broken' || observations.cta === 'missing') && config.ctaCritical === true) {
    if (observations.probeContext === 'automated') {
      const confirmations = Number(observations.ctaConfirmations ?? 0);
      const corroborated = observations.ctaCorroborated === true || confirmations >= 2;
      if (!corroborated) return { ...result, state: 'NOT_OBSERVABLE', scope: 'conversion-path-probe-ambiguous' };
    }
    return { ...result, state: 'DEGRADED', scope: 'conversion-path' };
  }

  return result;
}

export function initialRevenuePathLifecycle() {
  return {
    state: 'HEALTHY',
    incidentOpen: false,
    firstDetected: null,
    lastObservedAt: null,
    recoveryCandidateAt: null,
    healthyConfirmations: 0,
    recoveredAt: null,
    incidentOpenDurationMs: 0,
    observedExposureUpperBoundMs: null
  };
}

export function advanceRevenuePathLifecycle(previous, classified, observedAt, options = {}) {
  if (!STATES.has(classified?.state)) throw new Error('invalid classified state');
  const timestamp = new Date(observedAt).getTime();
  if (!Number.isFinite(timestamp)) throw new Error('invalid observedAt');

  const recoveryConfirmations = Math.max(1, options.recoveryConfirmations ?? 2);
  const current = previous ?? initialRevenuePathLifecycle();
  const lastObservedMs = current.lastObservedAt ? new Date(current.lastObservedAt).getTime() : null;

  if (Number.isFinite(lastObservedMs) && timestamp <= lastObservedMs) return current;

  const next = { ...current, lastObservedAt: new Date(timestamp).toISOString() };
  const unhealthy = classified.state === 'BROKEN' || classified.state === 'DEGRADED';

  if (unhealthy) {
    const firstDetected = current.incidentOpen && current.firstDetected
      ? current.firstDetected
      : new Date(timestamp).toISOString();
    const firstDetectedMs = new Date(firstDetected).getTime();
    return {
      ...next,
      state: classified.state,
      incidentOpen: true,
      firstDetected,
      recoveryCandidateAt: null,
      healthyConfirmations: 0,
      recoveredAt: null,
      incidentOpenDurationMs: Math.max(0, timestamp - firstDetectedMs),
      observedExposureUpperBoundMs: null
    };
  }

  if (!current.incidentOpen) {
    return {
      ...next,
      state: classified.state,
      healthyConfirmations: classified.state === 'HEALTHY' ? current.healthyConfirmations + 1 : 0
    };
  }

  if (classified.state === 'NOT_OBSERVABLE') {
    return {
      ...next,
      state: current.state,
      healthyConfirmations: 0,
      recoveryCandidateAt: null,
      observedExposureUpperBoundMs: null
    };
  }

  const confirmations = current.healthyConfirmations + 1;
  const recoveryCandidateAt = current.recoveryCandidateAt ?? new Date(timestamp).toISOString();
  const firstDetectedMs = new Date(current.firstDetected).getTime();
  const candidateMs = new Date(recoveryCandidateAt).getTime();
  const observedExposureUpperBoundMs = Math.max(0, candidateMs - firstDetectedMs);

  if (confirmations < recoveryConfirmations) {
    return {
      ...next,
      state: current.state,
      healthyConfirmations: confirmations,
      recoveryCandidateAt,
      incidentOpenDurationMs: Math.max(0, timestamp - firstDetectedMs),
      observedExposureUpperBoundMs
    };
  }

  return {
    ...next,
    state: 'HEALTHY',
    incidentOpen: false,
    firstDetected: current.firstDetected,
    healthyConfirmations: confirmations,
    recoveryCandidateAt,
    recoveredAt: new Date(timestamp).toISOString(),
    incidentOpenDurationMs: Math.max(0, timestamp - firstDetectedMs),
    observedExposureUpperBoundMs
  };
}
