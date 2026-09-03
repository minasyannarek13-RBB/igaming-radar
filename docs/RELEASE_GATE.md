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
- 2026-09-03 validation: GitHub Actions CI run `33678566098` for commit `8a76cf22bdbae09df7744dc31bad1e0e2f062aed` completed successfully. Both Node.js matrix jobs (`test (20)` and `test (22)`) completed with successful Test steps.
- 2026-09-03 scoreboard validation: GitHub Actions CI run `33684714247` for commit `eedc960cc0bdec7d8aaabc15d70422a460131ca7` completed successfully.
- 2026-09-03 canonical-head validation: GitHub Actions CI run `33694749287` for commit `83b3da5715393d9bb837fba140c643eb76a877c5` completed successfully.
- 2026-09-03 latest canonical-head validation: GitHub Actions CI run `33699087611` for commit `122143ceb94a497466b3f2a3014cd50649045413` completed successfully.
- 2026-09-03 current canonical-head validation: GitHub Actions CI run `33707438144` for commit `c01b43aa0daf26c84694be2a1dd9115a7367d0d4` completed successfully. The canonical main head therefore remains green across the release-gating correlation, attribution and historical-regression suites.
- 2026-09-03 canonical-head revalidation: GitHub Actions CI run `33710875993` for commit `4861783d91805038a4dfc6ae2be1fa04920cb9d9` completed successfully on first attempt. No regression was introduced after the prior release-evidence update.
- 2026-09-03 deployment validation: canonical main head `ce6494394b6ed0a8fc461d39909f0dc5ace81f91` reports successful Vercel deployment checks for both `igaming-radar` and `igaming-radar-v05`. This validates deployment completion for the current head, but does not by itself satisfy durable scheduled monitoring, crypto entitlement E2E, soak, or usable-product-link gates.
- 2026-09-03 deployment-evidence-head validation: GitHub Actions CI run `33732682573` for commit `ba6611701ee8ef54d8ecf20a5693df78254c87ef` completed successfully on first attempt. Vercel checks for both production targets also report `success`. The deployment-evidence update therefore introduced no release-gating regression.
- 2026-09-03 canonical-head validation: GitHub Actions CI run `33738469568` for commit `bca45a3af2d1c31df6fc5eef1675d7b1d0fd1cb7` completed successfully on first attempt. Both Vercel production checks (`igaming-radar` and `igaming-radar-v05`) are also `success`. No release-gating regression is observed on the latest validated head.
- 2026-09-03 latest-head validation: GitHub Actions CI run `33743858864` for commit `d2e203acb78fc6da1bcfed3036f2e06a247fe0c4` completed successfully on first attempt. Both Vercel production checks (`igaming-radar` and `igaming-radar-v05`) also report successful deployment. The latest canonical head therefore remains green across executable runtime/repository validation and the existing release-gating correlation, guarded-attribution and historical-regression suites.
- 2026-09-03 current-head validation: GitHub Actions CI run `33754843273` for commit `193743d69950b95d4dee573653b51013eb0390aa` completed successfully on first attempt. Both Node.js matrix jobs (`test (20)` and `test (22)`) completed with successful Test steps, and both Vercel production checks report `success`. No release-gating regression is observed on the canonical head.
- 2026-09-03 latest release-evidence-head validation: GitHub Actions CI run `33760762887` for commit `469042114ae3c0e2752fe5030a61105e938debc1` completed successfully on first attempt. Both Node.js matrix jobs (`test (20)` and `test (22)`) completed with successful Test steps, and both Vercel production checks (`igaming-radar` and `igaming-radar-v05`) report `success`. No release-gating regression is observed on the latest validated canonical head.
- 2026-09-03 current canonical-head validation: GitHub Actions CI run `33766246547` for commit `371df2a94079d547eb3411b3a8d85a59c659e3f0` completed successfully on first attempt. Both production Vercel checks (`igaming-radar` and `igaming-radar-v05`) also report `success`. The current canonical head remains green with no newly observed release-gating regression.
- 2026-09-03 latest canonical-head validation: GitHub Actions CI run `33772221817` for commit `17b95157b90e928a6e7c7de78591a79a8a04554f` completed successfully on first attempt. Both Node.js matrix jobs (`test (20)` and `test (22)`) completed with successful Test steps, and both production Vercel checks (`igaming-radar` and `igaming-radar-v05`) report `success`. No release-gating regression is observed on the latest canonical head.
- 2026-09-03 latest release-gate validation: GitHub Actions CI run `33783912893` for commit `82be7e9e160879d61c00eee6f05bb3d41f24eb05` completed successfully on first attempt. Both Node.js matrix jobs (`test (20)` and `test (22)`) completed with successful Test steps. Both production Vercel checks (`igaming-radar` and `igaming-radar-v05`) also report `success`. No new regression or blocker was observed; the existing blind-scan, fabricated-dependency, guarded-attribution and historical-regression evidence remains the release baseline.
- 2026-09-03 canonical-head release validation: GitHub Actions CI run `33790101308` for commit `6ab4eb985f75f14d9be6d3fadac67afb4e21bf21` completed successfully on first attempt. Both Node.js matrix jobs (`test (20)` and `test (22)`) completed with successful Test steps, and both production Vercel checks (`igaming-radar` and `igaming-radar-v05`) report `success`. No regression is observed in the executable release-gating baseline; blind-scan, fabricated-dependency, guarded HIGH-attribution and historical-replay evidence remain unchanged and valid.
- 2026-09-03 latest canonical-head release validation: GitHub Actions CI run `33796175762` for commit `7ddc207b8bf1727ee114ea23c42732cd15aa75e6` completed successfully on first attempt. Both Node.js matrix jobs (`test (20)` and `test (22)`) completed with successful Test steps, and both production Vercel checks (`igaming-radar` and `igaming-radar-v05`) report `success`. No new release-gating regression or blocker was observed; validated blind-scan, zero-fabrication, guarded HIGH-attribution and deterministic historical-replay evidence remain unchanged.
- 2026-09-04 current canonical-head release validation: GitHub Actions CI run `33801676223` for commit `496c2c35bcd911f61162706117671fa1f95dd544` completed successfully on first attempt. Both Node.js matrix jobs (`test (20)` and `test (22)`) completed with successful Test steps, and both production Vercel checks (`igaming-radar` and `igaming-radar-v05`) report `success`. No new release-gating regression or blocker was observed; validated 30/30 blind scans, zero fabricated dependencies, guarded HIGH-confidence attribution and deterministic historical regression remain the release baseline.
- 2026-09-04 latest canonical-head release validation: GitHub Actions CI run `33807512919` for commit `74db298110c00bcd55d65d225c323b7490022a30` completed successfully on first attempt. Both Node.js matrix jobs (`test (20)` and `test (22)`) completed with successful Test steps, and both production Vercel checks (`igaming-radar` and `igaming-radar-v05`) report `success`. No new release-gating regression or blocker was observed; the 30/30 blind-scan, zero-fabrication, guarded HIGH-attribution and deterministic historical-regression baseline remains valid.
- 2026-09-04 current release-gate validation: GitHub Actions CI run `33812751664` for commit `728ae84fa161bf22fbb8925e424a84c4855e0f62` completed successfully on first attempt. Both Node.js matrix jobs (`test (20)` and `test (22)`) completed with successful Test steps, and both production Vercel checks (`igaming-radar` and `igaming-radar-v05`) report `success`. No new release-gating regression or blocker was observed; the validated 30/30 blind-scan, zero fabricated-dependency, guarded HIGH-confidence attribution and deterministic historical-regression baseline remains valid.

## Definition of useful scan
A scan is useful only when it produces evidence that can materially help an operator understand dependency topology, an incident, degradation, or likely attribution. A technically successful request with no useful intelligence does not count as useful.

An explicit `Not observable externally` result is acceptable for the Free Scan validation corpus when the scanner cannot safely establish a dependency from public evidence. It must not be converted into an inferred dependency merely to improve the useful-rate metric.

## Attribution policy
HIGH confidence must never be emitted merely because two observations overlap in time. Attribution must be supported by dependency evidence and corroborating signals. Unknown is preferable to fabricated certainty.

## Remaining release blockers
1. Production crypto purchase -> signed payment confirmation -> entitlement E2E evidence.
2. Durable scheduled production execution evidence for monitoring/runtime.
3. 72-hour production-like soak.
4. Verified usable product link after the above gates pass.

## Release rule
No new feature enters development unless it materially increases the probability of passing this gate or completing the first Founder Early Access sale.
