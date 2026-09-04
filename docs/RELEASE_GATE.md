# Commercial MVP Release Gate

This file is the single source of truth for Founder Early Access readiness.

| Gate | Target | Current |
|---|---:|---:|
| Executable runtime | PASS | PASS |
| Evidence/data contracts | PASS | PASS |
| Scanner executable core | PASS | PASS |
| Free Scan API | PASS | PASS |
| Blind scans | 30 | PASS: 30/30 executed |
| Useful scans | >=90% | PASS: 30/30 acceptable; useful-or-explicit 100% |
| Fabricated dependencies | 0 | PASS: 0 in validated blind/adversarial evidence |
| Cross-operator correlation engine | PASS | PASS: current-head CI |
| HIGH-confidence false attribution | 0 | PASS: adversarial guards executed in current-head CI |
| Historical regression | PASS | PASS: deterministic replay suite executed in current-head CI |
| Crypto purchase E2E | PASS | PENDING production signed confirmation/entitlement verification |
| Security regression | PASS | PASS |
| Domain/Landing production runtime | PASS | PARTIAL PASS: current-head Vercel deployments successful; scheduled durable execution evidence pending |
| Soak | 72h | 0h |
| Verified usable product link | PASS | PENDING production E2E and soak |
| Commercial gate | OPEN | CLOSED |

## Current release evidence
- 2026-09-02: `src/correlation-attribution.js` implements deterministic fail-closed cross-operator grouping and attribution. HIGH requires >=2 affected operators, >=2 evidence IDs, >=2 provenance families, >=1 healthy control, zero unhealthy controls and zero competing dependency candidates.
- 2026-09-02: `test/correlation-attribution.test.js` adds adversarial cases for temporal coincidence without shared dependency, duplicate provenance, unhealthy controls, competing causes and insufficient independent evidence.
- 2026-09-02: `test/historical-replay.test.js` adds the historical regression gate: a shared-platform multi-operator replay can reach guarded HIGH only with independent historical provenance plus a healthy control; out-of-window timing and different dependencies produce no attribution.
- 2026-09-04 current canonical release validation: GitHub Actions CI run `33853157721` for commit `80448c08fa425e9de565c0c1eee926471043a659` completed successfully on first attempt. Both Node.js matrix jobs (`test (20)` and `test (22)`) completed with successful Test steps, and both production Vercel checks (`igaming-radar` and `igaming-radar-v05`) report `success`. No new release-gating regression or blocker was observed; validated 30/30 blind scans, zero fabricated dependencies, guarded HIGH-confidence attribution and deterministic historical regression remain the release baseline.

## Definition of useful scan
A scan is useful only when it produces evidence that can materially help an operator understand dependency topology, an incident, degradation, or likely attribution. A technically successful request with no useful intelligence does not count as useful.

An explicit `Not observable externally` result is acceptable for the Free Scan validation corpus when the scanner cannot safely establish a dependency from public evidence. It must not be converted into an inferred dependency merely to improve the useful-rate metric.

## Attribution policy
HIGH confidence must never be emitted merely because two observations overlap in time. Attribution must be supported by dependency evidence and corroborating signals. Unknown is preferable to fabricated certainty.

## Remaining release blockers
1. Production crypto purchase -> signed payment confirmation -> entitlement E2E evidence.
2. Durable scheduled production execution evidence for monitoring/runtime.
3. 72-hour production-like soak.
4. Verified usable product link after production E2E and soak.
