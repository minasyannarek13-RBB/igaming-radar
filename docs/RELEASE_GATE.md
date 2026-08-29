# Commercial MVP Release Gate

This file is the single source of truth for Founder Early Access readiness.

| Gate | Target | Current |
|---|---:|---:|
| Executable runtime | PASS | PASS |
| Evidence/data contracts | PASS | PASS |
| Scanner executable core | PASS | PASS (fixture QA only) |
| Blind scans | 30 | 0 |
| Useful scans | >=90% | NOT MEASURED |
| Fabricated dependencies | 0 | 0 in scanner fixture QA; blind corpus pending |
| HIGH-confidence false attribution | 0 | NOT MEASURED |
| Historical regression | PASS | PENDING |
| Crypto purchase E2E | PASS | PENDING |
| Security regression | PASS | PENDING |
| Soak | 72h | 0h |
| Commercial gate | OPEN | CLOSED |

## Evidence log
- 2026-08-30: Added executable provenance-first scanner core in `src/scanner.js` plus `test/scanner.test.js`. The scanner currently emits only direct public observations for a deliberately narrow CDN/Cloud fingerprint set (Cloudflare response header and explicit CloudFront/Akamai/Fastly hostnames). All emitted dependency edges are LOW confidence with evidence references; absence/fetch failure returns explicit `Not observable externally` rather than guessing. Five scanner fixture/adversarial tests passed locally against the committed implementation shape, including suffix-spoof resistance, no-signal non-fabrication, explicit CloudFront provenance, Cloudflare header provenance, and fetch-failure behavior. Commits: `3dd41373348d6c6e751ec938e5e77fb8046edb94`, `f40d1bf0fc950ddd62ff9504626214d10f11fc70`.
- 2026-08-30: Node.js runtime health/404 tests and executable evidence-contract tests were run against the current implementation shape on Node v22.16.0: 8 tests passed, 0 failed. A runtime import side effect that kept port 3000 open during tests was falsified and fixed in commit `5f828ed1f2c415d3ba84d65db9fdc488cd625159`.
- 2026-08-30: Evidence contract enforcement added in `src/evidence.js`; dependency edges require provenance, synthetic/replay evidence cannot be labeled live, and HIGH confidence requires two independent Observed sources.

## Definition of useful scan
A scan is useful only when it produces evidence that can materially help an operator understand dependency topology, an incident, degradation, or likely attribution. A technically successful request with no useful intelligence does not count as useful.

An explicit `Not observable externally` result is acceptable for the Free Scan validation corpus when the scanner cannot safely establish a dependency from public evidence. It must not be converted into an inferred dependency merely to improve the useful-rate metric.

## Attribution policy
HIGH confidence must never be emitted merely because two observations overlap in time. Attribution must be supported by dependency evidence and corroborating signals. Unknown is preferable to fabricated certainty.

## Release rule
No new feature enters development unless it materially increases the probability of passing this gate or completing the first Founder Early Access sale.
