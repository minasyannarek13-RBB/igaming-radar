# MVP Architecture

## Pipeline

1. **Scan** — collect public/operator-authorized observations.
2. **Graph** — normalize entities and dependency edges with provenance.
3. **Monitor** — collect health/change signals over time.
4. **Correlate** — group temporally and topologically related observations.
5. **Attribute** — rank candidate causes with evidence and confidence.
6. **Incident** — persist timeline, affected entities and investigation state.
7. **Exposure** — estimate affected time/window without claiming saved revenue.
8. **ROI Proof** — report observed, estimated and customer-confirmed value separately.

## Hard safety/data rules

- Every discovered dependency edge requires provenance.
- Inference and observation are different data types.
- A missing dependency must never be invented to make a correlation fit.
- HIGH attribution confidence requires explicit supporting evidence.
- External status/API/web-change signals are evidence, not automatic proof of causation.
- Revenue exposure is an estimate unless customer data confirms it.

## Minimal components

- API/runtime
- scanner adapters
- normalized topology store
- evidence store
- correlation engine
- attribution engine
- incident store
- ROI Proof calculator
- authentication/entitlement
- crypto payment adapter
- dashboard/API output
- regression/blind-scan test harness

## OSS boundary
Use commodity infrastructure where appropriate. Do not outsource the iGaming-specific graph semantics, correlation logic, attribution confidence model, incident intelligence, exposure logic or ROI Proof semantics.
