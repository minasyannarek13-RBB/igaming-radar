const AUTHORIZED = new Set(['PUBLIC_OR_AUTHORIZED_SANDBOX', 'AUTHORIZED_SANDBOX']);

function evidence(id, geo, observation, value) {
  return {
    id,
    pathStage: 'CASHIER_PAYMENT',
    geo,
    observation,
    value,
    provenance: {
      kind: 'fixture_or_authorized_probe',
      status: 'Observed'
    }
  };
}

export function classifyPaymentFlow(input = {}) {
  const { authorization, geo, observations = {}, controls = [] } = input;
  if (!AUTHORIZED.has(authorization)) {
    throw new Error('Payment Flow requires public or explicitly authorized sandbox evidence');
  }
  if (!geo) throw new Error('Payment Flow requires GEO');

  const evidenceItems = Object.entries(observations).map(([key, value], index) =>
    evidence(`payment-${index + 1}`, geo, key, value)
  );

  const base = {
    pathStage: 'CASHIER_PAYMENT',
    geo,
    dependency: null,
    dependencyEdges: [],
    cause: 'NOT_OBSERVABLE',
    confidence: 'GUARDED',
    evidence: evidenceItems,
    controls,
    savedGgr: null,
    savedRevenue: null,
    roiClaim: 'NOT_CLAIMED'
  };

  // Brand visibility is not dependency/root-cause evidence. Without repeated or otherwise
  // corroborated failure evidence, preserve ambiguity rather than naming a PSP.
  if (observations.brandLabel && observations.redirect === 'unreachable' && !observations.repeated) {
    return { ...base, state: 'NOT_OBSERVABLE' };
  }

  if (observations.cashier === 'unreachable' && observations.repeated === true) {
    return { ...base, state: 'BROKEN' };
  }

  if (observations.cashier === 'reachable' && observations.configuredMethod === 'missing' && observations.repeated === true) {
    return { ...base, state: 'DEGRADED' };
  }

  if (observations.cashier === 'reachable' && observations.method === 'visible' && observations.redirect === 'unreachable' && observations.repeated === true) {
    return { ...base, state: 'DEGRADED' };
  }

  if (observations.iframe === 'NOT_OBSERVABLE' || observations.callback === 'NOT_OBSERVABLE') {
    const observableHealthySurface = observations.cashier === 'reachable' && observations.method === 'visible' && observations.redirect === 'reachable';
    if (!observableHealthySurface) return { ...base, state: 'NOT_OBSERVABLE' };
  }

  if (observations.cashier === 'reachable' && observations.method === 'visible' && observations.redirect === 'reachable') {
    return { ...base, state: 'HEALTHY' };
  }

  return { ...base, state: 'NOT_OBSERVABLE' };
}
