# Commercial MVP Release Gate

This file is the single source of truth for Founder Early Access readiness.

| Gate | Target | Current |
|---|---:|---:|
| Executable runtime | PASS | PASS |
| Evidence/data contracts | PASS | PASS: live runtime corroboration now preserves requested/final URL, final hostname and HTTP status linked to the edge; independent QA verified |
| Scanner executable core | PASS | PASS (fixture QA + independent CI) |
| Free Scan API | PASS | PASS (independent CI) |
| Blind scans | 30 | PASS: 30/30 executed |
| Useful scans | >=90% | PASS: 30/30 acceptable (18 Observed, 12 explicit Not observable externally) |
| Fabricated dependencies | 0 | PENDING RED TEAM: prior 404/403/timeout/DNS fabricated-edge path fixed; final adversarial attribution checks remain |
| HIGH-confidence false attribution | 0 | IMPLEMENTATION FIXED / PENDING RED TEAM: HIGH now requires two explicitly distinct Observed `provenanceChannel` values; distinct URLs/sourceIds alone cannot satisfy HIGH |
| Historical regression | PASS | PENDING |
| Crypto purchase E2E | PASS | PENDING |
| Security regression | PASS | PENDING — DNS-rebinding fix committed; independent verification pending |
| Soak | 72h | 0h |
| Verified usable product link | PASS | PENDING canonical release-owner verification |
| Commercial gate | OPEN | CLOSED |

## Evidence log
- 2026-08-30: Build hardened HIGH-confidence independence in canonical `main` commit `2c0c2e88b54a792e8f95b092e5698f813a07744f`. `validateDependencyEdge` no longer deduplicates HIGH corroboration by `sourceId`; it requires at least two explicitly declared, distinct Observed `provenanceChannel` values. Regression coverage now proves that two different runtime URLs/sourceIds from the same channel fail HIGH, undeclared channels fail HIGH, and two explicitly independent channels can pass. GitHub Actions CI run `33310679162` completed SUCCESS and both Vercel status checks completed SUCCESS. This closes the implementation defect only; Free Scan remains CLOSED until Red Team independently verifies the guard and remaining fabricated-attribution/security checks.
- 2026-08-30: Release Owner reconciled the latest Build and Red Team evidence against canonical `main` (`e489bad494fe891f4f49b1321dddc8d732045d5e`). Vercel status checks are SUCCESS for both production projects on this SHA. Red Team independently verified that the prior live-corroboration provenance blocker is closed: dependency evidence now preserves requested URL, final URL/hostname and HTTP status linked to the edge. A new HIGH-confidence guard blocker is confirmed directly in `src/evidence.js`: independence is currently determined only by distinct `sourceId` values. Two Observed runtime-resource records from the same provider host/evidence class/channel can therefore be treated as two independent sources if their URLs/sourceIds differ. Free Scan remains CLOSED. Build acceptance: HIGH must require genuinely independent provenance channels, not merely distinct URLs/sourceIds from the same provider/runtime observation channel; two same-channel runtime resources must fail HIGH validation.
- 2026-08-30: Release Owner reconciled Build and Red Team against canonical `main` (`cf25280e0d0bb14306bcecc505e84f3399c78281`), GitHub Actions CI run `33303458229` (SUCCESS), Vercel production deployment `dpl_8jfSzEQ7ARnskvgkuKyku2uiCoC8` (READY on the same SHA), and production `/api/health` (200 OK). BUILD required live resource corroboration for HTML-derived Game Provider/RGS, Sportsbook/Platform and CDN/Cloud fingerprints and regression coverage rejects Entain 404/403/timeout/DNS failures. The provenance defect identified in that run has since been fixed and independently verified; this entry is retained as historical evidence.
- 2026-08-30: Release Owner previously blocked the Entain fingerprint because an exact runtime-looking `src` could create a dependency without confirming that the referenced JavaScript loaded. Required failure behavior was 404/403/timeout/DNS -> zero Entain dependency edges, with hostname allowed to remain Observed / UNATTRIBUTED. This implementation blocker is superseded by the corroboration build above.
- 2026-08-30: Build Lane fixed the redirected-operator topology regression: original and final legitimate operator hosts are internal for surface inventory; genuine third-party hosts remain external and UNATTRIBUTED. CI and Vercel production passed.
- 2026-08-30: Build Lane closed the DNS-rebinding/TOCTOU implementation gap by resolving and validating every redirect hop, rejecting any hop with non-public answers, and pinning HTTP/TLS to validated addresses while preserving Host/SNI. Security regression remains PENDING independent verification.
- 2026-08-30: GitHub Actions Blind Scan QA run `33281782461` executed all 30 fixed public operator/casino targets: 18 Observed, 12 explicit Not observable externally, 0 invalid, acceptable=30/30, useful-or-explicit=100% against a 90% target. This validates corpus shape/provenance but does not prove provider attribution accuracy.
- 2026-08-30: Scanner returns bounded external `observedSurfaces` as explicitly UNATTRIBUTED unless a supported fingerprint exists. Unknown is preferable to fabricated attribution.
- 2026-08-30: Evidence contract enforcement requires provenance, prevents synthetic/replay evidence from being labeled live. HIGH confidence requires genuinely independent Observed provenance; distinct `sourceId` values alone are not sufficient.

## Definition of useful scan
A scan is useful only when it produces evidence that can materially help an operator understand dependency topology, an incident, degradation, or likely attribution. A technically successful request with no useful intelligence does not count as useful.

An explicit `Not observable externally` result is acceptable for the Free Scan validation corpus when the scanner cannot safely establish a dependency from public evidence. It must not be converted into an inferred dependency merely to improve the useful-rate metric.

## Attribution policy
HIGH confidence must never be emitted merely because two observations overlap in time. Attribution must be supported by dependency evidence and corroborating signals. Unknown is preferable to fabricated certainty.

## Release rule
No new feature enters development unless it materially increases the probability of passing this gate or completing the first Founder Early Access sale.
