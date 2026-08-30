# Provider fingerprint evidence

## Play'n GO — `*.playngonetwork.com`

Status: ACTIVE, conservative LOW-confidence runtime fingerprint.
Capability: `Game Provider/RGS`.
Component: `Game delivery network`.

Evidence reviewed 2026-08-30:
- Cloudflare Radar certificate transparency shows wildcard certificates for `*.playngonetwork.com` with Organization `Play'n GO Malta limited` (current 2025–2027 certificate records).
- Public operator-specific subdomains such as `leovegas-cw.playngonetwork.com` are observable in public web indexing.
- Public technical guidance independently documents Play'n GO game traffic using casino-specific `*.playngonetwork.com` hosts.

Scanner policy:
- Exact/suffix-safe hostname match only; `playngonetwork.com.evil.example` must never match.
- Presence in operator HTML is recorded as live observed hostname evidence.
- Resulting dependency confidence remains `LOW`; this fingerprint alone must never create HIGH-confidence root-cause attribution.
- Unknown external hostnames remain `UNATTRIBUTED`.

Sources:
- https://radar.cloudflare.com/domains/domain/playngonetwork.com
- https://rtpcheck.com/post/how-to-check-the-rtp-of-play-n-go-slots
