# Evidence Contract v0.1

Radar must not create a dependency edge without provenance.

## Observation states
- Observed: directly supported by captured external evidence.
- Inferred: derived from one or more observations; inference logic and source observations must be retained.
- Not observable externally: the scanner cannot safely establish the dependency from public evidence.

## Required evidence fields
Every evidence record must contain: source identifier, observation timestamp, locator or fingerprint, evidence class, and observation state.

## Trusted provenance families
When `provenanceChannel` is supplied, its family must belong to the closed taxonomy enforced by `src/evidence.js`. Current trusted families are `runtime_resource_http`, `authoritative_dns`, `first_party_metadata`, and `tls_certificate`. A channel may add a suffix for audit scope, for example `runtime_resource_http:provider-x`, but suffixes do not create independence. Unknown or arbitrary families are invalid evidence.

## Dependency edge
Every operator -> capability -> provider -> component edge must reference at least one evidence record. HIGH confidence requires corroboration from at least two independent trusted Observed provenance families. Two URLs, source IDs, or channel suffixes within the same provenance family count as one family. An inference alone cannot be HIGH confidence.

## Factuality
Absence of evidence is not evidence of absence. Scanner output must prefer Not observable externally over guessing. Synthetic and replay evidence must be labeled and cannot be presented as live observation.
