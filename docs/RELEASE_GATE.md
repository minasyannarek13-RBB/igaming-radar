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
| Cross-operator correlation engine | PASS | IMPLEMENTED; CI confirmation pending for current head |
| HIGH-confidence false attribution | 0 | IMPLEMENTED adversarial guards; current-head CI confirmation pending |
| Historical regression | PASS | IMPLEMENTED deterministic replay suite; current-head CI confirmation pending |
| Crypto purchase E2E | PASS | PENDING production signed confirmation/entitlement verification |
| Security regression | PASS | PASS |
| Domain/Landing production runtime | PASS | PARTIAL PASS: deployed one-shot runtime; scheduled durable execution evidence pending |
| Soak | 72h | 0h |
| Verified usable product link | PASS | PENDING production E2E and soak |
| Commercial gate | OPEN | CLOSED |

## Current release evidence
- 2026-09-02: `src/correlation-attribution.js` implements deterministic fail-closed cross-operator grouping and attribution. HIGH requires >=2 affected operators, >=2 evidence IDs, >=2 provenance families, >=1 healthy control, zero unhealthy controls and zero competing dependency candidates.
- 2026-09-02: `test/correlation-attribution.test.js` adds adversarial cases for temporal coincidence without shared dependency, duplicate provenance, unhealthy controls, competing causes and insufficient independent evidence.
- 2026-09-02: `test/historical-replay.test.js` adds the historical regression gate: a shared-platform multi-operator replay can reach guarded HIGH only with independent historical provenance plus a healthy control; out-of-window timing and different dependencies produce no attribution.
- Current-head GitHub Actions confirmation is still required before correlation/attribution and historical regression may be marked PASS. No workflow run was returned for commit `a100feda450501a8a93f5f550a9688c555eb70ff`; therefore implementation is not being misreported as executed CI evidence.

## Definition of useful scan
A scan is useful only when it produces evidence that can materially help an operator understand dependency topology, an incident, degradation, or likely attribution. A technically successful request with no useful intelligence does not count as useful.

An explicit `Not observable externally` result is acceptable for the Free Scan validation corpus when the scanner cannot safely establish a dependency from public evidence. It must not be converted into an inferred dependency merely to improve the useful-rate metric.

## Attribution policy
HIGH confidence must never be emitted merely because two observations overlap in time. Attribution must be supported by dependency evidence and corroborating signals. Unknown is preferable to fabricated certainty.

## Release rule
No new feature enters development unless it materially increases the probability of passing this gate or completing the first Founder Early Access sale.
