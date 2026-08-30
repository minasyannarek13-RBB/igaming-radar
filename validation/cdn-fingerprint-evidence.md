# CDN/Cloud fingerprint evidence

## 2026-08-30 runtime-use guard

Build Lane tightened existing hostname fingerprints for Amazon CloudFront, Akamai (`akamaized.net`, `akamaihd.net`) and Fastly (`fastly.net`). A CDN/Cloud dependency edge now requires the recognized hostname to be used as a runtime `src` resource. A plain `href` hyperlink to the same hostname remains an Observed `UNATTRIBUTED` external surface and does not create a dependency edge.

This change is intentionally conservative: false negatives are preferred to fabricated dependency attribution. Cloudflare header evidence (`cf-ray`) is unchanged because it remains a direct response-header observation.

Implementation commit: `c196e14f133a0302c411544ba2a41c5523cbc760`.
Regression-test commit: `0d2e3b8048a1786c202dea47a025151e4e9adf21`.
GitHub Actions CI run `33298506595`: SUCCESS.
Vercel production deployment `dpl_H4FJEw1noTrAAZcd9B7ctjizy5PP`: READY on commit `0d2e3b8048a1786c202dea47a025151e4e9adf21`.

The scanner gate remains in dependency-discovery work. This evidence does not claim Sportsbook/Platform coverage and does not advance any attribution confidence level.
