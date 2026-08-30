export const OBSERVATION_STATES = Object.freeze({
  OBSERVED: 'Observed',
  INFERRED: 'Inferred',
  NOT_OBSERVABLE: 'Not observable externally'
});

const REQUIRED_EVIDENCE_FIELDS = Object.freeze([
  'sourceId',
  'observedAt',
  'locator',
  'evidenceClass',
  'state'
]);

export function validateEvidence(record) {
  const errors = [];

  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return { ok: false, errors: ['evidence must be an object'] };
  }

  for (const field of REQUIRED_EVIDENCE_FIELDS) {
    const value = record[field];
    if (typeof value !== 'string' || value.trim() === '') {
      errors.push(`missing or invalid ${field}`);
    }
  }

  if (record.provenanceChannel !== undefined &&
      (typeof record.provenanceChannel !== 'string' || record.provenanceChannel.trim() === '')) {
    errors.push('invalid provenanceChannel');
  }

  if (record.state && !Object.values(OBSERVATION_STATES).includes(record.state)) {
    errors.push('invalid observation state');
  }

  if (record.observedAt && Number.isNaN(Date.parse(record.observedAt))) {
    errors.push('observedAt must be an ISO-parseable timestamp');
  }

  if (record.synthetic === true && record.live === true) {
    errors.push('synthetic evidence cannot be labeled live');
  }

  if (record.replay === true && record.live === true) {
    errors.push('replay evidence cannot be labeled live');
  }

  return { ok: errors.length === 0, errors };
}

export function validateDependencyEdge(edge, evidenceById = new Map()) {
  const errors = [];

  if (!edge || typeof edge !== 'object' || Array.isArray(edge)) {
    return { ok: false, errors: ['dependency edge must be an object'] };
  }

  for (const field of ['operator', 'capability', 'provider', 'component', 'confidence']) {
    if (typeof edge[field] !== 'string' || edge[field].trim() === '') {
      errors.push(`missing or invalid ${field}`);
    }
  }

  if (!Array.isArray(edge.evidenceIds) || edge.evidenceIds.length === 0) {
    errors.push('dependency edge requires at least one evidence reference');
    return { ok: false, errors };
  }

  const evidenceRecords = [];
  for (const id of edge.evidenceIds) {
    const evidence = evidenceById.get(id);
    if (!evidence) {
      errors.push(`missing evidence reference: ${id}`);
      continue;
    }
    const validation = validateEvidence(evidence);
    if (!validation.ok) {
      errors.push(`invalid evidence ${id}: ${validation.errors.join(', ')}`);
      continue;
    }
    evidenceRecords.push(evidence);
  }

  if (edge.confidence === 'HIGH') {
    const observedChannels = new Set(
      evidenceRecords
        .filter((record) =>
          record.state === OBSERVATION_STATES.OBSERVED &&
          typeof record.provenanceChannel === 'string' &&
          record.provenanceChannel.trim() !== '')
        .map((record) => record.provenanceChannel.trim())
    );

    if (observedChannels.size < 2) {
      errors.push('HIGH confidence requires at least two independent Observed provenance channels');
    }
  }

  return { ok: errors.length === 0, errors };
}
