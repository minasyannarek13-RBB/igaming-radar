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

  // Automated probes can be challenged by bot/WAF controls. This is ambiguous
  // evidence about player reachability and must not be promoted to an outage.
  if (
    observations.probeContext === 'automated' &&
    observations.http === 403 &&
    observations.page === 'challenge'
  ) {
    return { ...result, state: 'NOT_OBSERVABLE', scope: 'probe-ambiguous' };
  }

  if (observations.dns === 'fail') {
    // A single resolver/probe failure is evidence of a failed observation, not
    // evidence that the operator domain is globally or locally unreachable.
    // BROKEN requires explicit corroboration or a multi-vantage observation.
    const confirmations = Number(observations.dnsConfirmations ?? 0);
    const corroborated = observations.dnsCorroborated === true || confirmations >= 2;

    if (geo === 'MULTI') {
      return { ...result, state: 'BROKEN', scope: 'global-observed' };
    }

    if (corroborated) {
      return { ...result, state: 'BROKEN', scope: 'target-corroborated' };
    }

    const independentHealthyControls = controls.filter((control) => healthyControl(control, geo));
    if (observations.probeContext === 'automated' || independentHealthyControls.length > 0) {
      return { ...result, state: 'NOT_OBSERVABLE', scope: 'dns-probe-ambiguous' };
    }

    return { ...result, state: 'NOT_OBSERVABLE', scope: 'dns-unconfirmed' };
  }

  if (observations.tls === 'fail') {
    // As with DNS, one automated TLS handshake failure may be caused by a
    // transient/vantage-specific path, SNI/probe behavior, or address choice.
    // Preserve the failed observation but only promote it to BROKEN when the
    // failure is explicitly corroborated or genuinely multi-vantage.
    const confirmations = Number(observations.tlsConfirmations ?? 0);
    const corroborated = observations.tlsCorroborated === true || confirmations >= 2;

    if (geo === 'MULTI') {
      return { ...result, state: 'BROKEN', scope: 'global-observed' };
    }

    if (corroborated) {
      return { ...result, state: 'BROKEN', scope: 'target-corroborated' };
    }

    const independentHealthyControls = controls.filter((control) => healthyControl(control, geo));
    if (observations.probeContext === 'automated' || independentHealthyControls.length > 0) {
      return { ...result, state: 'NOT_OBSERVABLE', scope: 'tls-probe-ambiguous' };
    }

    return { ...result, state: 'NOT_OBSERVABLE', scope: 'tls-unconfirmed' };
  }

  if (observations.redirect === 'loop') {
    return { ...result, state: 'BROKEN', scope: 'target' };
  }

  if (observations.http === 200 && observations.page === 'error-template') {
    // A soft-200 error/interstitial seen by one automated vantage can be caused
    // by probe-specific edge/WAF/personalization behavior. Preserve the exact
    // observation, but require explicit repeated/corroborated or genuinely
    // multi-vantage evidence before opening a proven landing incident.
    const confirmations = Number(observations.pageConfirmations ?? 0);
    const corroborated = observations.pageCorroborated === true || confirmations >= 2;

    if (geo === 'MULTI') {
      return { ...result, state: 'BROKEN', scope: 'landing-global-observed' };
    }

    if (corroborated) {
      return { ...result, state: 'BROKEN', scope: 'landing-corroborated' };
    }

    const independentHealthyControls = controls.filter((control) => healthyControl(control, geo));
    if (observations.probeContext === 'automated' || independentHealthyControls.length > 0) {
      return { ...result, state: 'NOT_OBSERVABLE', scope: 'soft-200-probe-ambiguous' };
    }

    return { ...result, state: 'NOT_OBSERVABLE', scope: 'soft-200-unconfirmed' };
  }

  if ([403, 451].includes(observations.http) && observations.page === 'unavailable') {
    const mirrorHealthy = controls.some(
      (control) => control?.target && control.geo === geo && control.state === 'HEALTHY'
    );
    if (mirrorHealthy) {
      return { ...result, state: 'BROKEN', scope: 'mirror-only-observed' };
    }

    const independentGeoControls = controls.filter((control) => healthyControl(control, geo));
    if (independentGeoControls.length >= 2) {
      return { ...result, state: 'BROKEN', scope: 'geo-local-observed' };
    }

    return { ...result, state: 'NOT_OBSERVABLE', scope: 'geo-ambiguous' };
  }

  if (observations.criticalAssets === 'broken') {
    return { ...result, state: 'DEGRADED', scope: 'landing-assets' };
  }

  if (observations.cta === 'broken' || observations.cta === 'missing') {
    if (config.ctaCritical === true) {
      return { ...result, state: 'DEGRADED', scope: 'conversion-path' };
    }
  }

  // Unrelated third-party failures are retained as evidence only. They do not
  // create a revenue-path dependency edge or degrade the target by themselves.
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
    exposureDurationMs: 0
  };
}

export function advanceRevenuePathLifecycle(previous, classified, observedAt, options = {}) {
  if (!STATES.has(classified?.state)) throw new Error('invalid classified state');
  const timestamp = new Date(observedAt).getTime();
  if (!Number.isFinite(timestamp)) throw new Error('invalid observedAt');

  const recoveryConfirmations = Math.max(1, options.recoveryConfirmations ?? 2);
  const current = previous ?? initialRevenuePathLifecycle();
  const lastObservedMs = current.lastObservedAt
    ? new Date(current.lastObservedAt).getTime()
    : null;

  // Persisted lifecycle is an event-time state machine. Delayed observations
  // must not move state backward, and equal timestamps are first-write-wins so
  // retries/duplicates cannot alter recovery hysteresis or exposure duration.
  if (Number.isFinite(lastObservedMs) && timestamp <= lastObservedMs) {
    return current;
  }

  const next = { ...current, lastObservedAt: new Date(timestamp).toISOString() };
  const unhealthy = classified.state === 'BROKEN' || classified.state === 'DEGRADED';

  if (unhealthy) {
    return {
      ...next,
      state: classified.state,
      incidentOpen: true,
      firstDetected: current.incidentOpen && current.firstDetected
        ? current.firstDetected
        : new Date(timestamp).toISOString(),
      recoveryCandidateAt: null,
      healthyConfirmations: 0,
      recoveredAt: null,
      exposureDurationMs: current.incidentOpen && current.firstDetected
        ? Math.max(0, timestamp - new Date(current.firstDetected).getTime())
        : 0
    };
  }

  if (!current.incidentOpen) {
    return {
      ...next,
      state: classified.state,
      healthyConfirmations: classified.state === 'HEALTHY' ? current.healthyConfirmations + 1 : 0
    };
  }

  // NOT_OBSERVABLE cannot prove recovery.
  if (classified.state === 'NOT_OBSERVABLE') {
    return { ...next, state: current.state, healthyConfirmations: 0, recoveryCandidateAt: null };
  }

  const confirmations = current.healthyConfirmations + 1;
  const recoveryCandidateAt = current.recoveryCandidateAt ?? new Date(timestamp).toISOString();
  if (confirmations < recoveryConfirmations) {
    return {
      ...next,
      state: current.state,
      healthyConfirmations: confirmations,
      recoveryCandidateAt
    };
  }

  const firstDetectedMs = new Date(current.firstDetected).getTime();
  return {
    ...next,
    state: 'HEALTHY',
    incidentOpen: false,
    firstDetected: current.firstDetected,
    healthyConfirmations: confirmations,
    recoveryCandidateAt,
    recoveredAt: new Date(timestamp).toISOString(),
    exposureDurationMs: Math.max(0, timestamp - firstDetectedMs)
  };
}
