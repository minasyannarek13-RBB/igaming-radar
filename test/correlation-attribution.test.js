import test from 'node:test';
import assert from 'node:assert/strict';
import { correlateAndAttribute } from '../src/correlation-attribution.js';

const t='2026-09-02T12:00:00Z';
const row=(x={})=>({observedAt:t,dependencyId:'shared-platform',status:'UNHEALTHY',evidenceId:'e1',provenanceFamily:'probe-a',operatorId:'op-a',...x});

test('HIGH requires independent evidence and a healthy control',()=>{
 const r=correlateAndAttribute([row(),row({operatorId:'op-b',evidenceId:'e2',provenanceFamily:'probe-b'}),row({operatorId:'control',status:'HEALTHY',control:true,evidenceId:'c1',provenanceFamily:'control-probe'})]);
 assert.equal(r.candidates[0].confidence,'HIGH');
});

test('temporal coincidence without shared dependency never attributes',()=>{
 const r=correlateAndAttribute([row(),row({operatorId:'op-b',dependencyId:'other',evidenceId:'e2',provenanceFamily:'probe-b'})]);
 assert.equal(r.candidates.length,0);
});

test('duplicate provenance family cannot reach HIGH',()=>{
 const r=correlateAndAttribute([row(),row({operatorId:'op-b',evidenceId:'e2'}),row({operatorId:'control',status:'HEALTHY',control:true,evidenceId:'c1'})]);
 assert.notEqual(r.candidates[0].confidence,'HIGH');
});

test('unhealthy control cannot reach HIGH',()=>{
 const r=correlateAndAttribute([row(),row({operatorId:'op-b',evidenceId:'e2',provenanceFamily:'probe-b'}),row({operatorId:'control',status:'UNHEALTHY',control:true,evidenceId:'c1',provenanceFamily:'control-probe'})]);
 assert.notEqual(r.candidates[0].confidence,'HIGH');
});

test('competing candidate cause cannot reach HIGH',()=>{
 const r=correlateAndAttribute([row({competingDependencyIds:['other']}),row({operatorId:'op-b',evidenceId:'e2',provenanceFamily:'probe-b'}),row({operatorId:'control',status:'HEALTHY',control:true,evidenceId:'c1',provenanceFamily:'control-probe'})]);
 assert.notEqual(r.candidates[0].confidence,'HIGH');
});

test('insufficient independent evidence cannot reach HIGH',()=>{
 const r=correlateAndAttribute([row(),row({operatorId:'op-b'})]);
 assert.notEqual(r.candidates[0].confidence,'HIGH');
});
