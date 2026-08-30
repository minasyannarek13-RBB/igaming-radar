# Sportsbook/Platform fingerprint evidence

Status: BUILD evidence only. Independent QA/release acceptance remains separate.

## Runtime evidence

The 30-domain blind corpus run at `c196e14f133a0302c411544ba2a41c5523cbc760` exposed Entain-owned `itsfogo.com` runtime surfaces on real operators without requiring browser-side invention:

- `bwin.com` loaded `src` JavaScript from `scmedia.itsfogo.com/$-$/7187bf0a675b46a89627b38d9d3d0f66.js` and additional same-pattern runtime files.
- `betmgm.com` loaded `src` JavaScript from `scmedia.itsfogo.com/$-$/13fa6e2aa5294c458438038f82b576e8.js` plus same-pattern files, including `scmedia-us.itsfogo.com`.
- `coral.co.uk` and `ladbrokes.com` exposed `media.itsfogo.com` image resources only. Those are deliberately NOT attributed as Sportsbook/Platform dependencies.

The blind artifact itself remained 30/30 acceptable with 0 invalid evidence records before this fingerprint was added. This file does not convert that earlier QA result into acceptance of the new fingerprint.

## Attribution contract

A LOW-confidence `Sportsbook/Platform -> Entain -> Shared application runtime` edge is created only when all of these are observed and externally corroborated:

1. resource is loaded via `src`;
2. hostname is exactly `scmedia.itsfogo.com` or `scmedia-us.itsfogo.com`;
3. path matches the observed runtime form `/$-$/<32 hex>.js`;
4. hostname suffix validation still passes `itsfogo.com` ownership boundary checks;
5. a separate SSRF-guarded public fetch of the exact resource succeeds with a 2xx response and the final redirect hostname remains inside the same fingerprint suffix.

Everything else under `itsfogo.com` remains `Observed / UNATTRIBUTED` unless another independently supported fingerprint exists. A runtime-looking URL in HTML is no longer sufficient on its own to create a dependency edge.

The same positive-resource corroboration rule now applies to all HTML-derived provider/platform/CDN fingerprints. Cloudflare `cf-ray` remains direct response-header evidence and does not use the HTML resource probe path.

## Negative guards

`test/platform-fingerprint.test.js` verifies that no dependency edge is created for:

- hyperlink-only references, even when the path looks runtime-like;
- generic `media.itsfogo.com` assets;
- suffix-spoofed hosts such as `scmedia.itsfogo.com.attacker.example`;
- unrelated `itsfogo.com` hosts with runtime-looking paths;
- exact-pattern Entain runtime URLs returning 404;
- exact-pattern Entain runtime URLs returning 403;
- resource fetch timeout/failure;
- resource DNS failure.

For these unavailable-resource cases the hostname may remain `Observed / UNATTRIBUTED`, but evidence/dependency arrays stay empty. Truth thresholds were not weakened.

The positive case remains LOW confidence and requires live provenance evidence. No HIGH-confidence claim is introduced.

## Verification

Original guarded fingerprint:

- implementation commit: `7de3bc2b820e9a1677cf5a535958448d6b4efdf1`
- guard-test commit: `68e9a2dd75302780617f15b8e5bf5b4532b58252`
- GitHub Actions CI run `33300852844`: SUCCESS

Live-resource corroboration hardening:

- implementation commit: `5af28d101cb07f794a51972af8839c2b240fa830`
- unavailable-resource tests: `dc2f762d8be98cebd7e56620ce700daaa1601755`
- GitHub Actions CI run `33303418232`: SUCCESS
- Vercel production deployment `dpl_tJPDXWVEKzTWssx5NUggtDV3eAWp`: READY on `dc2f762d8be98cebd7e56620ce700daaa1601755`

This closes the BUILD-side Red Team case where a fabricated or dead exact-pattern runtime URL could become a Sportsbook/Platform dependency. It does not declare the scanner gate or Free Scan release gate passed; Red Team / Release Owner must independently falsify the hardened behavior and rerun release evidence as required.
