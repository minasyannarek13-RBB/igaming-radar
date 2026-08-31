export const domainLandingFixtures = [
  {
    id: 'healthy-control',
    target: 'https://healthy.example/landing',
    geo: 'DE',
    observations: { dns: 'ok', tls: 'ok', http: 200, redirect: 'ok', page: 'ok', criticalAssets: 'ok', cta: 'ok' },
    expected: { state: 'HEALTHY', scope: 'none', attributable: false }
  },
  {
    id: 'global-outage',
    target: 'https://global-outage.example/landing',
    geo: 'MULTI',
    observations: { dns: 'fail', tls: 'not_observed', http: 'not_observed', redirect: 'not_observed', page: 'not_observed', criticalAssets: 'not_observed', cta: 'not_observed' },
    expected: { state: 'BROKEN', scope: 'global-observed', attributable: false }
  },
  {
    id: 'geo-local-failure',
    target: 'https://geo-local.example/landing',
    geo: 'TR',
    controls: [{ geo: 'DE', state: 'HEALTHY' }, { geo: 'NL', state: 'HEALTHY' }],
    observations: { dns: 'ok', tls: 'ok', http: 451, redirect: 'ok', page: 'unavailable', criticalAssets: 'not_observed', cta: 'not_observed' },
    expected: { state: 'BROKEN', scope: 'geo-local-observed', attributable: false }
  },
  {
    id: 'blocked-mirror',
    target: 'https://mirror.example/',
    geo: 'TR',
    controls: [{ target: 'https://primary.example/', geo: 'TR', state: 'HEALTHY' }],
    observations: { dns: 'ok', tls: 'ok', http: 403, redirect: 'ok', page: 'unavailable', criticalAssets: 'not_observed', cta: 'not_observed' },
    expected: { state: 'BROKEN', scope: 'mirror-only-observed', attributable: false, cause: 'NOT_OBSERVABLE' }
  },
  {
    id: 'redirect-loop',
    target: 'https://redirect-loop.example/landing',
    geo: 'DE',
    observations: { dns: 'ok', tls: 'ok', http: 302, redirect: 'loop', page: 'unavailable', criticalAssets: 'not_observed', cta: 'not_observed' },
    expected: { state: 'BROKEN', scope: 'target', attributable: false }
  },
  {
    id: 'soft-200-error-page',
    target: 'https://soft200.example/landing',
    geo: 'DE',
    observations: { dns: 'ok', tls: 'ok', http: 200, redirect: 'ok', page: 'error-template', criticalAssets: 'ok', cta: 'missing' },
    expected: { state: 'BROKEN', scope: 'landing', attributable: false }
  },
  {
    id: 'broken-cta',
    target: 'https://broken-cta.example/landing',
    geo: 'DE',
    config: { ctaCritical: true },
    observations: { dns: 'ok', tls: 'ok', http: 200, redirect: 'ok', page: 'ok', criticalAssets: 'ok', cta: 'broken' },
    expected: { state: 'DEGRADED', scope: 'conversion-path', attributable: false }
  },
  {
    id: 'analytics-cdn-noise',
    target: 'https://cdn-noise.example/landing',
    geo: 'DE',
    observations: { dns: 'ok', tls: 'ok', http: 200, redirect: 'ok', page: 'ok', criticalAssets: 'ok', cta: 'ok', unrelatedThirdPartyAsset: 'failed' },
    expected: { state: 'HEALTHY', scope: 'none', attributable: false, dependencyEdges: 0 }
  },
  {
    id: 'waf-bot-ambiguous',
    target: 'https://waf-ambiguous.example/landing',
    geo: 'DE',
    observations: { dns: 'ok', tls: 'ok', http: 403, redirect: 'ok', page: 'challenge', criticalAssets: 'not_observed', cta: 'not_observed', probeContext: 'automated' },
    expected: { state: 'NOT_OBSERVABLE', scope: 'probe-ambiguous', attributable: false, cause: 'NOT_OBSERVABLE' }
  }
];
