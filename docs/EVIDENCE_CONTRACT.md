# Evidence Contract v0.1

Radar must not create a dependency edge without provenance.

## Observation states
- Observed: directly supported by captured external evidence.
- Inferred: derived from one or more observations; inference logic and source observations must be retained.
- Not observable externally: the scanner cannot safely establish the dependency from public evidence.

## Required evidence fields
Every evidence record must contain: source identifier, observation timestamp, locator or fingerprint, evidence class, and observation state.

## Dependency edge
Every operator -> capability -> provider -> component edge must reference at least one evidence record. HIGH confidence requires corroboration from at least two independent observed evidence sources. An inference alone cannot be HIGH confidence.

## Factuality
Absence of evidence is not evidence of absence. Scanner output must prefer Not observable externally over guessing. Synthetic and replay evidence must be labeled and cannot be presented as live observation.
