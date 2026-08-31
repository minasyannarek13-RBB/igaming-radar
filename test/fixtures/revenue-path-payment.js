// Deterministic Payment Flow fixtures only. No real deposits, credentials, or access-control bypass.
export const paymentFlowFixtures = [
  {
    id: 'cashier-method-healthy',
    pathStage: 'CASHIER_PAYMENT',
    authorization: 'PUBLIC_OR_AUTHORIZED_SANDBOX',
    geo: 'DE',
    observations: { cashier: 'reachable', method: 'visible', redirect: 'reachable', callback: 'NOT_OBSERVABLE' },
    controls: [],
    expected: { state: 'HEALTHY', attributable: false, dependencyEdges: 0, cause: 'NOT_OBSERVABLE' }
  },
  {
    id: 'cashier-unreachable-corroborated',
    pathStage: 'CASHIER_PAYMENT',
    authorization: 'AUTHORIZED_SANDBOX',
    geo: 'DE',
    observations: { cashier: 'unreachable', repeated: true },
    controls: [{ geo: 'DE', surface: 'landing', state: 'HEALTHY' }],
    expected: { state: 'BROKEN', attributable: false, dependencyEdges: 0, cause: 'NOT_OBSERVABLE' }
  },
  {
    id: 'payment-method-missing',
    pathStage: 'CASHIER_PAYMENT',
    authorization: 'AUTHORIZED_SANDBOX',
    geo: 'DE',
    observations: { cashier: 'reachable', configuredMethod: 'missing', repeated: true },
    controls: [{ geo: 'NL', configuredMethod: 'visible', state: 'HEALTHY' }],
    expected: { state: 'DEGRADED', attributable: false, dependencyEdges: 0, cause: 'NOT_OBSERVABLE' }
  },
  {
    id: 'psp-redirect-unreachable',
    pathStage: 'CASHIER_PAYMENT',
    authorization: 'AUTHORIZED_SANDBOX',
    geo: 'DE',
    observations: { cashier: 'reachable', method: 'visible', redirect: 'unreachable', repeated: true },
    controls: [],
    expected: { state: 'DEGRADED', attributable: false, dependencyEdges: 0, cause: 'NOT_OBSERVABLE' }
  },
  {
    id: 'iframe-unobservable',
    pathStage: 'CASHIER_PAYMENT',
    authorization: 'PUBLIC_OR_AUTHORIZED_SANDBOX',
    geo: 'DE',
    observations: { cashier: 'reachable', iframe: 'NOT_OBSERVABLE' },
    controls: [],
    expected: { state: 'NOT_OBSERVABLE', attributable: false, dependencyEdges: 0, cause: 'NOT_OBSERVABLE' }
  },
  {
    id: 'callback-unobservable',
    pathStage: 'CASHIER_PAYMENT',
    authorization: 'AUTHORIZED_SANDBOX',
    geo: 'DE',
    observations: { cashier: 'reachable', redirect: 'reachable', callback: 'NOT_OBSERVABLE' },
    controls: [],
    expected: { state: 'NOT_OBSERVABLE', attributable: false, dependencyEdges: 0, cause: 'NOT_OBSERVABLE' }
  },
  {
    id: 'psp-brand-visible-no-attribution',
    pathStage: 'CASHIER_PAYMENT',
    authorization: 'PUBLIC_OR_AUTHORIZED_SANDBOX',
    geo: 'DE',
    observations: { cashier: 'reachable', method: 'visible', brandLabel: 'ExamplePay', redirect: 'unreachable' },
    controls: [],
    expected: { state: 'NOT_OBSERVABLE', attributable: false, dependencyEdges: 0, cause: 'NOT_OBSERVABLE' }
  }
];
