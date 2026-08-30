# Commercial MVP Release Gate

This file is the single source of truth for Founder Early Access readiness.

| Gate | Target | Current |
|---|---:|---:|
| Executable runtime | PASS | PASS |
| Evidence/data contracts | PASS | PASS: live runtime corroboration preserves requested/final URL, final hostname and HTTP status linked to the edge; provenance family taxonomy is now closed in code |
| Scanner executable core | PASS | PASS (fixture QA + independent CI) |
| Free Scan API | PASS | PASS (independent CI) |
| Blind scans | 30 | PASS: 30/30 executed |
| Useful scans | >=90% | PASS: 30/30 acceptable (18 Observed, 12 explicit Not observable externally) |
| Fabricated dependencies | 0 | PENDING RED TEAM: prior 404/403/timeout/DNS fabricated-edge path fixed; final adversarial attribution checks remain |
| HIGH-confidence false attribution | 0 | IMPLEMENTATION FIXED / PENDING RED TEAM: HIGH now counts independence by closed trusted provenance family, not arbitrary channel string/sourceId/URL; same-family suffix variants cannot satisfy HIGH |
| Historical regression | PASS | PENDING |
| Crypto purchase E2E | PASS | PENDING |
| Security regression | PASS | BUILD HARDENED / PENDING RED TEAM: DNS pinning/redirect guard plus IPv4-mapped, IPv6 transition/special-range SSRF regressions now pass CI and blind-scan QA |
| Soak | 72h | 0h |
| Verified usable product link | PASS | PENDING canonical release-owner verification |
| Commercial gate | OPEN | CLOSED |

## Evidence log
- 2026-08-30: Build hardened the scanner's DNS-rebinding/SSRF boundary beyond the prior DNS pinning fix. `isPrivateIp` now canonicalizes IPv6 before policy checks and fail-closes IPv4-compatible, IPv4-mapped private ranges, NAT64 (`64:ff9b::/96` and local-use variants), discard/special ranges, Teredo (`2001::/32` canonical form), benchmarking/documentation ranges and 6to4 (`2002::/16`). Regression coverage verifies a DNS answer in an IPv6 transition range is rejected before fetch. The first Teredo regression intentionally failed because Node canonicalizes `2001:0::/32` as `2001::`; Build corrected the guard without weakening the test. Canonical head `83bd57f210d0bee587cf63925c86bee90a67cc72` passed GitHub Actions CI run `33319041677`, Blind Scan QA run `33319041654`, and both Vercel project checks. Security remains PENDING independent Red Team replay before Free Scan release.
- 2026-08-30: Build closed the Red Team arbitrary-`provenanceChannel` HIGH-confidence bypass. Canonical `main` now enforces a closed provenance-family taxonomy (`runtime_resource_http`, `authoritative_dns`, `first_party_metadata`, `tls_certificate`) and HIGH deduplicates corroboration by trusted family rather than the full channel string. Adversarial regressions prove `runtime_resource_http:A` + `runtime_resource_http:B` fails HIGH, an unknown/fake family is rejected as invalid evidence, undeclared channels fail HIGH, and two different trusted families can pass. Code/test head `dd94a3c91b40cdd7ad45a4172751637c4e33007a` passed GitHub Actions CI run `33313339836`; both Vercel status checks on that SHA are SUCCESS. Evidence contract docs were updated afterward. Implementation blocker is closed; Free Scan remains CLOSED until independent Red Team verification of this fix plus remaining fabricated-attribution/security checks.
- 2026-08-30: Build hardened HIGH-confidence independence in canonical `main` commit `2c0c2e88b54a792e8f95b092e5698f813a07744f`. `validateDependencyEdge` stopped deduplicating HIGH corroboration by `sourceId` and required explicitly distinct Observed `provenanceChannel` values. Regression coverage proved that two different runtime URLs/sourceIds from the same exact channel fail HIGH and undeclared channels fail HIGH. This was an intermediate hardening step later superseded by closed provenance-family enforcement after Red Team showed arbitrary channel labels could still fake independence.
- 2026-08-30: Release Owner reconciled the previous Build and Red Team evidence against canonical `main` (`e489bad494fe891f4f49b1321dddc8d732045d5e`). Red Team independently verified that the prior live-corroboration provenance blocker was closed: dependency evidence preserves requested URL, final URL/hostname and HTTP status linked to the edge. It then found that HIGH-confidence independence was determined only by distinct `sourceId` values. That defect was fixed by the subsequent provenance-channel and provenance-family guards.
- 2026-08-30: Release Owner reconciled Build and Red Team against canonical `main` (`cf25280e0d0bb14306bcecc505e84f3399c78281`), GitHub Actions CI run `33303458229` (SUCCESS), Vercel production deployment `dpl_8jfSzEQ7ARnskvgkuKyku2uiCoC8` (READY on the same SHA), and production `/api/health` (200 OK). BUILD required live resource corroboration for HTML-derived Game Provider/RGS, Sportsbook/Platform and CDN/Cloud fingerprints and regression coverage rejects Entain 404/403/timeout/DNS failures. The provenance defect identified in that run has since been fixed and independently verified; this entry is retained as historical evidence.
- 2026-08-30: Release Owner previously blocked the Entain fingerprint because an exact runtime-looking `src` could create a dependency without confirming that the referenced JavaScript loaded. Required failure behavior was 404/403/timeout/DNS -> zero Entain dependency edges, with hostname allowed to remain Observed / UNATTRIBUTED. This implementation blocker is superseded by the corroboration build above.
- 2026-08-30: Build Lane fixed the redirected-operator topology regression: original and final legitimate operator hosts are internal for surface inventory; genuine third-party hosts remain external and UNATTRIBUTED. CI and Vercel production passed.
- 2026-08-30: Build Lane closed the DNS-rebinding/TOCTOU implementation gap by resolving and validating every redirect hop, rejecting any hop with non-public answers, and pinning HTTP/TLS to validated addresses while preserving Host/SNI. Security regression remains PENDING independent verification.
- 2026-08-30: GitHub Actions Blind Scan QA run `33281782461` executed all 30 fixed public operator/casino targets: 18 Observed, 12 explicit Not observable externally, 0 invalid, acceptable=30/30, useful-or-explicit=100% against a 90% target. This validates corpus shape/provenance but does not prove provider attribution accuracy.
- 2026-08-30: Scanner returns bounded external `observedSurfaces` as explicitly UNATTRIBUTED unless a supported fingerprint exists. Unknown is preferable to fabricated attribution.
- 2026-08-30: Evidence contract enforcement requires provenance, prevents synthetic/replay evidence from being labeled live. HIGH confidence requires genuinely independent Observed provenance; arbitrary source IDs, URLs or channel suffixes do not create independent corroboration.

## Definition of useful scan
A scan is useful only when it produces evidence that can materially help an operator understand dependency topology, an incident, degradation, or likely attribution. A technically successful request with no useful intelligence does not count as useful.

An explicit `Not observable externally` result is acceptable for the Free Scan validation corpus when the scanner cannot safely establish a dependency from public evidence. It must not be converted into an inferred dependency merely to improve the useful-rate metric.

## Attribution policy
HIGH confidence must never be emitted merely because two observations overlap in time. Attribution must be supported by dependency evidence and corroborating signals. Unknown is preferable to fabricated certainty.

## Release rule
No new feature enters development unless it materially increases the probability of passing this gate or completing the first Founder Early Access sale.
