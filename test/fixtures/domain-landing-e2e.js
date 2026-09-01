export const domainLandingFixtures = Object.freeze({
  healthyControl: {
    geo: 'GB',
    observations: { probeContext: 'automated', dns: 'ok', tls: 'ok', http: 200, redirect: 'none', page: 'content', cta: 'present', criticalAssets: 'healthy' },
    controls: [], config: { ctaCritical: true }, expected: { state: 'HEALTHY', scope: 'none' }
  },
  globalOutage: {
    geo: 'MULTI', observations: { probeContext: 'automated', dns: 'fail' }, controls: [], config: {},
    expected: { state: 'BROKEN', scope: 'global-observed' }
  },
  geoLocalFailure: {
    geo: 'DE', observations: { probeContext: 'automated', dns: 'ok', tls: 'ok', http: 451, page: 'unavailable', accessConfirmations: 2 },
    controls: [{ geo: 'GB', state: 'HEALTHY' }, { geo: 'NL', state: 'HEALTHY' }], config: {},
    expected: { state: 'BROKEN', scope: 'geo-local-observed' }
  },
  blockedMirror: {
    geo: 'DE', observations: { probeContext: 'automated', dns: 'ok', tls: 'ok', http: 403, page: 'unavailable', accessConfirmations: 2 },
    controls: [{ target: 'https://mirror.example/', geo: 'DE', state: 'HEALTHY' }], config: {},
    expected: { state: 'BROKEN', scope: 'mirror-only-observed' }
  },
  ambiguousAccessBlock: {
    geo: 'DE', observations: { probeContext: 'automated', dns: 'ok', tls: 'ok', http: 403, page: 'unavailable' },
    controls: [{ target: 'https://mirror.example/', geo: 'DE', state: 'HEALTHY' }], config: {},
    expected: { state: 'NOT_OBSERVABLE', scope: 'geo-ambiguous' }
  },
  redirectLoop: {
    geo: 'DE', observations: { probeContext: 'automated', dns: 'ok', tls: 'ok', redirect: 'loop' }, controls: [], config: {},
    expected: { state: 'BROKEN', scope: 'target' }
  },
  soft200SingleProbe: {
    geo: 'DE', observations: { probeContext: 'automated', dns: 'ok', tls: 'ok', http: 200, page: 'error-template' }, controls: [], config: {},
    expected: { state: 'NOT_OBSERVABLE', scope: 'soft-200-probe-ambiguous' }
  },
  brokenCriticalCta: {
    geo: 'GB', observations: { probeContext: 'automated', dns: 'ok', tls: 'ok', http: 200, page: 'content', cta: 'missing', ctaConfirmations: 2 }, controls: [], config: { ctaCritical: true },
    expected: { state: 'DEGRADED', scope: 'conversion-path' }
  },
  analyticsCdnNoise: {
    geo: 'GB', observations: { probeContext: 'automated', dns: 'ok', tls: 'ok', http: 200, page: 'content', cta: 'present', thirdPartyNoise: [{ host: 'analytics.example', state: 'BROKEN' }, { host: 'cdn-marketing.example', state: 'BROKEN' }] },
    controls: [], config: { ctaCritical: true }, expected: { state: 'HEALTHY', scope: 'none' }
  }
});
