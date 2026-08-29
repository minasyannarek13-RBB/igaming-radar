import { readFile, writeFile } from 'node:fs/promises';
import { scanTarget } from '../src/scanner.js';

function parseTargets(text) {
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));
}

function validateResult(result) {
  const errors = [];
  const state = result?.state;
  if (!['Observed', 'Inferred', 'Not observable externally'].includes(state)) {
    errors.push('invalid_state');
  }

  if (state === 'Observed') {
    if (!Array.isArray(result.evidence) || result.evidence.length === 0) errors.push('observed_without_evidence');
    if (!Array.isArray(result.dependencies) || result.dependencies.length === 0) errors.push('observed_without_dependencies');
  }

  for (const edge of result?.dependencies || []) {
    if (!Array.isArray(edge.evidenceIds) || edge.evidenceIds.length === 0) {
      errors.push('dependency_without_provenance');
    }
  }
  return errors;
}

async function main() {
  const inputPath = process.argv[2] || 'validation/blind-targets.txt';
  const outputPath = process.argv[3] || 'validation/blind-results.json';
  const targets = parseTargets(await readFile(inputPath, 'utf8'));

  if (targets.length !== 30) {
    throw new Error(`blind corpus must contain exactly 30 targets; found ${targets.length}`);
  }

  const records = [];
  for (const target of targets) {
    const startedAt = new Date().toISOString();
    try {
      const result = await scanTarget(target);
      const validationErrors = validateResult(result);
      records.push({ target, startedAt, result, validationErrors });
      process.stdout.write(`${target}\t${result.state}\t${validationErrors.length ? validationErrors.join(',') : 'ok'}\n`);
    } catch (error) {
      records.push({ target, startedAt, error: error?.message || 'scan_error', validationErrors: ['scan_exception'] });
      process.stdout.write(`${target}\tERROR\t${error?.message || 'scan_error'}\n`);
    }
  }

  const acceptable = records.filter(record =>
    record.validationErrors?.length === 0 &&
    ['Observed', 'Not observable externally'].includes(record.result?.state)
  ).length;
  const observed = records.filter(record => record.result?.state === 'Observed' && record.validationErrors?.length === 0).length;
  const notObservable = records.filter(record => record.result?.state === 'Not observable externally' && record.validationErrors?.length === 0).length;
  const invalid = records.length - acceptable;
  const usefulOrExplicitRate = records.length ? acceptable / records.length : 0;

  const report = {
    generatedAt: new Date().toISOString(),
    corpusSize: records.length,
    summary: {
      observed,
      notObservable,
      invalid,
      acceptable,
      usefulOrExplicitRate,
      targetRate: 0.9,
      gatePass: records.length === 30 && usefulOrExplicitRate >= 0.9 && invalid === 0
    },
    records
  };

  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report.summary));

  if (!report.summary.gatePass) process.exitCode = 1;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
