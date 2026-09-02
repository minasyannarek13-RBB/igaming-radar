const CONFIDENCE = Object.freeze({ NONE: 'NONE', LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH' });

function uniq(values) { return [...new Set(values.filter(Boolean))]; }

/** Deterministic, fail-closed correlation/attribution for the commercial gate.
 * Input observations must already be evidence-validated.
 */
export function correlateAndAttribute(observations, { windowMs = 5 * 60_000 } = {}) {
  if (!Array.isArray(observations) || observations.length < 2) return { candidates: [] };
  const sorted = observations.filter(o => o && Number.isFinite(Date.parse(o.observedAt))).sort((a,b)=>Date.parse(a.observedAt)-Date.parse(b.observedAt));
  const groups = new Map();
  for (const o of sorted) {
    if (!o.operatorId || !o.dependencyId || !o.evidenceId || !o.provenanceFamily) continue;
    const arr = groups.get(o.dependencyId) || [];
    arr.push(o); groups.set(o.dependencyId, arr);
  }
  const candidates = [];
  for (const [dependencyId, rows] of groups) {
    const affected = rows.filter(r => r.status === 'UNHEALTHY');
    const operators = uniq(affected.map(r => r.operatorId));
    if (operators.length < 2) continue;
    const times = affected.map(r => Date.parse(r.observedAt));
    const temporalOverlap = Math.max(...times) - Math.min(...times) <= windowMs;
    if (!temporalOverlap) continue;
    const provenanceFamilies = uniq(affected.map(r => r.provenanceFamily));
    const evidenceIds = uniq(affected.map(r => r.evidenceId));
    const healthyControls = rows.filter(r => r.status === 'HEALTHY' && r.control === true);
    const unhealthyControls = rows.filter(r => r.status === 'UNHEALTHY' && r.control === true);
    const competing = uniq(affected.flatMap(r => r.competingDependencyIds || [])).filter(x => x !== dependencyId);
    let confidence = CONFIDENCE.LOW;
    const highGuard = operators.length >= 2 && evidenceIds.length >= 2 && provenanceFamilies.length >= 2 && healthyControls.length >= 1 && unhealthyControls.length === 0 && competing.length === 0;
    if (highGuard) confidence = CONFIDENCE.HIGH;
    else if (operators.length >= 2 && evidenceIds.length >= 2 && unhealthyControls.length === 0) confidence = CONFIDENCE.MEDIUM;
    candidates.push({ dependencyId, affectedOperators: operators, evidenceIds, provenanceFamilies, healthyControlCount: healthyControls.length, unhealthyControlCount: unhealthyControls.length, competingDependencyIds: competing, confidence });
  }
  return { candidates: candidates.sort((a,b) => ({HIGH:3,MEDIUM:2,LOW:1}[b.confidence]-({HIGH:3,MEDIUM:2,LOW:1}[a.confidence])) };
}

export { CONFIDENCE };
