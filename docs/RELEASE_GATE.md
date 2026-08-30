# Commercial MVP Release Gate

This file is the single source of truth for Founder Early Access readiness.

| Gate | Target | Current |
|---|---:|---:|
| Executable runtime | PASS | PASS |
| Evidence/data contracts | PASS | BLOCKED: live runtime corroboration is not auditable in returned edge evidence |
| Scanner executable core | PASS | PASS (fixture QA + independent CI) |
| Free Scan API | PASS | PASS (independent CI) |
| Blind scans | 30 | PASS: 30/30 executed |
| Useful scans | >=90% | PASS: 30/30 acceptable (18 Observed, 12 explicit Not observable externally) |
| Fabricated dependencies | 0 | PENDING RED TEAM: 404/403/timeout/DNS fabricated-edge path fixed in BUILD; provenance defect remains |
| HIGH-confidence false attribution | 0 | NOT MEASURED |
| Historical regression | PASS | PENDING |
| Crypto purchase E2E | PASS | PENDING |
| Security regression | PASS | PENDING — DNS-rebinding fix committed; independent verification pending |
| Soak | 72h | 0h |
| Verified usable product link | PASS | PENDING canonical release-owner verification |
| Commercial gate | OPEN | CLOSED |

## Evidence log
- 2026-08-30: Release Owner reconciled Build and Red Team against canonical `main` (`cf25280e0d0bb14306bcecc505e84f3399c78281`), GitHub Actions CI run `33303458229` (SUCCESS), Vercel production deployment `dpl_8jfSzEQ7ARnskvgkuKyku2uiCoC8` (READY on the same SHA), and production `/api/health` (200 OK). BUILD now requires live resource corroboration for HTML-derived Game Provider/RGS, Sportsbook/Platform and CDN/Cloud fingerprints and regression coverage rejects Entain 404/403/timeout/DNS failures, so the prior syntactic-runtime fabricated-edge path is implementation-fixed. Red Team found a new evidence-contract blocker: after successful corroboration, returned dependency evidence retains only the HTML hostname signal and does not expose the requested runtime resource plus successful/final HTTP observation used to authorize the edge. Free Scan remains CLOSED until dependency provenance is auditable end-to-end. Build acceptance: successful corroboration must preserve evidence for the concrete requested resource and successful final observation (at minimum requested URL/path, final URL/hostname and successful HTTP status), linked to the dependency edge; failure paths remain zero-edge.
- 2026-08-30: Release Owner previously blocked the Entain fingerprint because an exact runtime-looking `src` could create a dependency without confirming that the referenced JavaScript loaded. Required failure behavior was 404/403/timeout/DNS -> zero Entain dependency edges, with hostname allowed to remain Observed / UNATTRIBUTED. This implementation blocker is superseded by the corroboration build above; independent QA provenance verification is still required.
- 2026-08-30: Build Lane fixed the redirected-operator topology regression: original and final legitimate operator hosts are internal for surface inventory; genuine third-party hosts remain external and UNATTRIBUTED. CI and Vercel production passed.
- 2026-08-30: Build Lane closed the DNS-rebinding/TOCTOU implementation gap by resolving and validating every redirect hop, rejecting any hop with non-public answers, and pinning HTTP/TLS to validated addresses while preserving Host/SNI. Security regression remains PENDING independent verification.
- 2026-08-30: GitHub Actions Blind Scan QA run `33281782461` executed all 30 fixed public operator/casino targets: 18 Observed, 12 explicit Not observable externally, 0 invalid, acceptable=30/30, useful-or-explicit=100% against a 90% target. This validates corpus shape/provenance but does not prove provider attribution accuracy.
- 2026-08-30: Scanner returns bounded external `observedSurfaces` as explicitly UNATTRIBUTED unless a supported fingerprint exists. Unknown is preferable to fabricated attribution.
- 2026-08-30: Evidence contract enforcement requires provenance, prevents synthetic/replay evidence from being labeled live, and requires two independent Observed sources for HIGH confidence.

## Definition of useful scan
A scan is useful only when it produces evidence that can materially help an operator understand dependency topology, an incident, degradation, or likely attribution. A technically successful request with no useful intelligence does not count as useful.

An explicit `Not observable externally` result is acceptable for the Free Scan validation corpus when the scanner cannot safely establish a dependency from public evidence. It must not be converted into an inferred dependency merely to improve the useful-rate metric.

## Attribution policy
HIGH confidence must never be emitted merely because two observations overlap in time. Attribution must be supported by dependency evidence and corroborating signals. Unknown is preferable to fabricated certainty.

## Release rule
No new feature enters development unless it materially increases the probability of passing this gate or completing the first Founder Early Access sale.
