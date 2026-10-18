import test from 'node:test';
import assert from 'node:assert/strict';
import {validateAccountBehavior} from '../../server/providers/account-behavior-preview.mjs';
import {gateAccountBehaviorResult,behaviorReviewChecklist} from '../../server/providers/account-behavior-gate.mjs';
import {makeAccountBehaviorCases} from '../../scripts/preview-account-behavior.mjs';
import {makeBehaviorSemanticNegatives} from '../fixtures/account-behavior-negatives.mjs';

test('valid output is held for human semantics review, with no public result',()=>{
 const c=makeAccountBehaviorCases()[0];
 assert.equal(validateAccountBehavior(c.input,c.expected),true);
 const result=gateAccountBehaviorResult(c.input,c.expected);
 assert.equal(result.publicationState,'pending_human_review');assert.equal(result.publicResult,null);
 assert.equal(result.semanticReview,'not_performed');assert.equal(result.reviewRequired,true);
 assert.deepEqual(result.contextCoverage,{replyCount:3,repliesWithParentText:3});
 assert.deepEqual(result.checklist.map(r=>r.id),['parent_context','operator_identity','intent','scope_and_quotes','qualitative_and_readable']);
});

for(const c of makeBehaviorSemanticNegatives())test(`semantic counterexample is not auto-approved: ${c.id}`,()=>{
 // This assertion is intentional: citation/format checks do not catch this meaning.
 assert.equal(validateAccountBehavior(c.input,c.expected),true);
 const result=gateAccountBehaviorResult(c.input,c.expected);
 assert.equal(result.publicationState,'pending_human_review');assert.equal(result.publicResult,null);
 assert.equal(result.semanticReview,'not_performed');
});

test('prose URL from model is blocked, never silently cleaned to pass the contract',()=>{
 const c=makeAccountBehaviorCases()[0];c.expected.findings[0].observation='分享 https://example.invalid/tool';
 const before=structuredClone(c.expected);const result=gateAccountBehaviorResult(c.input,c.expected);
 assert.equal(result.publicationState,'blocked_invalid');assert.equal(result.publicResult,null);
 assert.match(result.structuralError,/URLs/);assert.deepEqual(c.expected,before);
});

test('invalid quote or research cannot be passed to public output',()=>{
 for(const field of ['quote','research']){
  const c=structuredClone(makeAccountBehaviorCases()[0]);
  if(field==='quote')c.expected.findings[0].evidence[0].quote='捏造原文';
  else c.expected.findings[0].researchIds=['not-supplied'];
  const result=gateAccountBehaviorResult(c.input,c.expected);
  assert.equal(result.publicationState,'blocked_invalid');assert.equal(result.publicResult,null);
 }
});

test('review fingerprints bind original input and output, without modifying either',()=>{
 const c=makeAccountBehaviorCases()[0];const original=structuredClone(c);
 const one=gateAccountBehaviorResult(c.input,c.expected);assert.deepEqual(c,original);
 const two=gateAccountBehaviorResult(c.input,c.expected);assert.equal(one.inputHash,two.inputHash);assert.equal(one.outputHash,two.outputHash);
 c.expected.findings[0].interpretation+='但仍需核對其他活動。';
 assert.notEqual(one.outputHash,gateAccountBehaviorResult(c.input,c.expected).outputHash);
 c.input.evidence[0].parentText=null;
 assert.notEqual(one.inputHash,gateAccountBehaviorResult(c.input,c.expected).inputHash);
});

test('model-added approvals, extra caller flags, and malformed outputs cannot release text',()=>{
 const c=makeAccountBehaviorCases()[0];
 assert.equal(gateAccountBehaviorResult(c.input,c.expected,{approved:true}).publicResult,null);
 assert.equal(gateAccountBehaviorResult(c.input,{...c.expected,approved:true}).publicationState,'blocked_invalid');
 assert.equal(gateAccountBehaviorResult(c.input,null).publicationState,'blocked_invalid');
 assert.equal(gateAccountBehaviorResult(null,c.expected).publicationState,'blocked_invalid');
 assert.equal(Object.isFrozen(behaviorReviewChecklist),true);
});
