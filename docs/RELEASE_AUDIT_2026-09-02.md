# Release QA audit — 2026-09-02

Canonical head inspected: `00f81d5539b1f8017756be31e1848f13806c9e1e`.

## Verified

- Executable Node runtime exists (`npm start`, Node >=20).
- Canonical CI run #205 on head `00f81d5` completed successfully.
- Blind-scan gate remains evidenced as 30/30 executed, 100% useful-or-explicit, with explicit Not observable externally allowed instead of invented mappings.
- Adversarial evidence validation exists for fabricated dependency prevention, provenance-family independence and HIGH-confidence evidence guards.
- Security regressions cover SSRF/DNS rebinding/redirect/private-range and IPv6 transition cases.
- Production Domain/Landing endpoints exist in canonical source and prior release evidence records public health/API deployment verification.

## Material release blocker found by repository audit

The canonical source tree contains scanner/evidence/domain-landing/revenue-path/payment/authz components, but no dedicated cross-operator correlation engine or attribution/root-cause engine/module and no historical incident replay fixture/suite. Repository code search for correlation/replay implementation returned no implementation evidence. Therefore the existing `HIGH-confidence false attribution = PASS` result must be interpreted narrowly as evidence-contract/provenance guard validation; it does **not** prove end-to-end cross-operator root-cause attribution accuracy.

This also explains why `Historical regression` remains PENDING in `docs/RELEASE_GATE.md`.

## Required next gating work

1. Implement the minimal deterministic cross-operator correlation + guarded attribution engine using only evidence-backed dependency edges.
2. Add historical replay fixtures with immutable expected outcomes. Start with the already validated shared-platform incident case only if its evidence can be represented without inventing timestamps/dependencies.
3. Add adversarial fixtures: temporal coincidence without shared dependency; shared dependency with unhealthy controls; duplicate provenance family; conflicting candidate causes; insufficient evidence. HIGH must be impossible in each unsupported case.
4. Run the historical replay and adversarial attribution suite in canonical CI.
5. Only after this passes may `Historical regression` and end-to-end `HIGH-confidence false attribution` be marked PASS.

## Gate impact

Commercial gate remains CLOSED. No founder decision is required for this blocker; it is an implementation/QA task.
