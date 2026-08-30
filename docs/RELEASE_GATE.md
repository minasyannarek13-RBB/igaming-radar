# Commercial MVP Release Gate

This file is the single source of truth for Founder Early Access readiness.

| Gate | Target | Current |
|---|---:|---:|
| Executable runtime | PASS | PASS |
| Evidence/data contracts | PASS | PASS |
| Scanner executable core | PASS | PASS (fixture QA + independent CI) |
| Free Scan API | PASS | PASS (independent CI) |
| Blind scans | 30 | PASS: 30/30 executed |
| Useful scans | >=90% | PASS: 30/30 acceptable (18 Observed, 12 explicit Not observable externally) |
| Fabricated dependencies | 0 | 0 invalid/provenance failures in blind corpus; adversarial QA continues |
| HIGH-confidence false attribution | 0 | NOT MEASURED |
| Historical regression | PASS | PENDING |
| Crypto purchase E2E | PASS | PENDING |
| Security regression | PASS | PENDING — DNS-rebinding fix committed; independent verification pending |
| Soak | 72h | 0h |
| Verified usable product link | PASS | PENDING canonical release-owner verification |
| Commercial gate | OPEN | CLOSED |

## Evidence log
- 2026-08-30: Build Lane fixed a real-operator provenance/topology regression exposed by QA: after a legitimate operator redirect such as `operator.example -> www.operator.example`, the final operator hostname was previously inventoried as an external `UNATTRIBUTED` surface because inventory compared resources only with the original target hostname. `src/scanner.js` now treats both the original target hostname and final redirect hostname as internal operator hosts for surface inventory. Unknown third-party hosts remain external and `UNATTRIBUTED`; no dependency attribution thresholds were changed. Regression coverage asserts that the final redirected operator host is excluded while a genuine third-party surface remains visible. Implementation commits: `b8da5fe893d070823f7b6990bc4583af2e6a87e3`, `9f25ce02ea7e7dfece1a837403aeb8550a6be470`; GitHub Actions CI run `33296182696` completed successfully on the latter commit, and Vercel production deployment for the same SHA reached `READY`.
- 2026-08-30: Build Lane closed the Red Team DNS-rebinding/TOCTOU implementation gap in commits `4b50f96dbe97cce9768f9901096cbbc5b168eff7` and `176ac359e3064cbe9f0d585ab74f541bc9a4c690`. Production scanner requests no longer perform a second independent DNS lookup through global `fetch`: each redirect hop resolves all addresses, rejects the hop if any answer is non-public, and the HTTP/TLS connection is pinned directly to one of those already-validated addresses while preserving the original Host header and TLS SNI/certificate validation. Redirects remain manual and each hop is re-resolved/re-validated. IPv4-mapped IPv6 addresses, including dotted and hexadecimal mapped forms, are normalized through the same IPv4 private/reserved range guard; tests cover 172.16/12, CGNAT 100.64/10, loopback, RFC1918 and metadata/link-local mapped forms. Security regression remains PENDING until independent CI/Red Team and production verification complete.
- 2026-08-30: GitHub Actions Blind Scan QA run `33281782461` executed all 30 fixed public operator/casino targets from `validation/blind-targets.txt`: 18 returned evidence-backed `Observed`, 12 returned explicit `Not observable externally`, 0 records were invalid, acceptable=30/30, useful-or-explicit rate=100%, target=90%, `gatePass=true`. The workflow also ran 18 unit/contract/security-shape tests with 18 passed / 0 failed and uploaded `blind-scan-results` artifact `9723198109`. This passes the current Free Scan blind-corpus shape/provenance gate; it does not by itself prove provider-level attribution accuracy.
- 2026-08-30: Scanner build advanced dependency discovery without weakening attribution: `src/scanner.js` now returns a bounded `observedSurfaces` inventory of public external hostnames found in page markup. These surfaces are explicitly `UNATTRIBUTED` and are never converted into dependency edges without a supported fingerprint. This creates evidence for subsequent Game Provider/RGS and Sportsbook/Platform fingerprint validation while preserving the rule that unknown is preferable to fabricated attribution. Tests assert that an unknown external vendor surface remains `Not observable externally` with zero dependency edges.
- 2026-08-30: GitHub Actions run `33281313262` independently executed the committed test suite after the CI lockfile/cache configuration bug was removed. Node 20 completed 16 tests with 16 passed / 0 failed; Node 22 job also completed successfully. This covers evidence contracts, runtime health/404 behavior, `POST /api/scan` API validation/delegation, suffix-spoof resistance, no-signal non-fabrication, explicit CloudFront provenance, Cloudflare header provenance, and fetch-failure `Not observable externally` behavior. Free Scan API is therefore marked PASS for executable CI evidence. Commit fixing CI: `d56ffae0266f6a950f107de0b4d311b56d678b0b`.
- 2026-08-30: Initial CI run failed before tests because `actions/setup-node` was configured with `cache: npm` while the repository had no dependency lockfile. This was a CI configuration failure, not a product test failure, and was corrected by removing the lockfile-dependent cache setting.
- 2026-08-30: Added `POST /api/scan` to the executable HTTP runtime. It validates `target`, rejects malformed JSON, delegates to `scanTarget`, and has API contract tests in `test/health.test.js`.
- 2026-08-30: Added executable blind-scan harness `scripts/blind-scan.js`, `npm run qa:blind`, and a fixed 30-domain public validation corpus in `validation/blind-targets.txt`. The harness refuses corpora other than exactly 30 targets, validates observation state/provenance shape, records full per-target results, and only passes when >=90% of results are either valid Observed or explicit Not observable externally with zero invalid records.
- 2026-08-30: Added executable provenance-first scanner core in `src/scanner.js` plus `test/scanner.test.js`. The scanner emits only direct public observations for a deliberately narrow CDN/Cloud fingerprint set (Cloudflare response header and explicit CloudFront/Akamai/Fastly hostnames). All emitted dependency edges are LOW confidence with evidence references; absence/fetch failure returns explicit `Not observable externally` rather than guessing.
- 2026-08-30: Evidence contract enforcement added in `src/evidence.js`; dependency edges require provenance, synthetic/replay evidence cannot be labeled live, and HIGH confidence requires two independent Observed sources.

## Definition of useful scan
A scan is useful only when it produces evidence that can materially help an operator understand dependency topology, an incident, degradation, or likely attribution. A technically successful request with no useful intelligence does not count as useful.

An explicit `Not observable externally` result is acceptable for the Free Scan validation corpus when the scanner cannot safely establish a dependency from public evidence. It must not be converted into an inferred dependency merely to improve the useful-rate metric.

## Attribution policy
HIGH confidence must never be emitted merely because two observations overlap in time. Attribution must be supported by dependency evidence and corroborating signals. Unknown is preferable to fabricated certainty.

## Release rule
No new feature enters development unless it materially increases the probability of passing this gate or completing the first Founder Early Access sale.
