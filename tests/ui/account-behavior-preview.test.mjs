import test from 'node:test';
import assert from 'node:assert/strict';
import {buildAccountBehaviorInput,validateAccountBehavior} from '../../server/providers/account-behavior-preview.mjs';
import {buildGeminiPreview,runGemini} from '../../server/providers/gemini-preview.mjs';
import {makeAccountBehaviorCases} from '../../scripts/preview-account-behavior.mjs';
const sample=()=>structuredClone(makeAccountBehaviorCases()[1]);
test('packet uses original activity and dated coverage, never scores or rule judgments',()=>{
 const input=buildAccountBehaviorInput({account:{username:'author',name:'公開名稱',secret:'omit'},completedAt:'2026-10-17T00:00:00Z',posts:[{id:'p',author:'author',kind:'post',text:'短口號',postedAt:'2026-07-29T00:00:00Z'}],comments:[{id:'r',author:'author',text:'讚',postedAt:'2025-08-01T00:00:00Z',parentAuthor:'other'},{id:'wrong',author:'someone_else',text:'不是本人'}],score:{value:99},analysis:{judgment:'preassigned'},rawPayload:{token:'omit'}});
 assert.equal(input.evidence.length,2);assert.equal(input.account.name,'公開名稱');assert.equal(input.account.nameHistory,null);assert.equal(input.coverage.posts.from,'2026-07-29T00:00:00Z');assert.equal(input.coverage.replies.from,'2025-08-01T00:00:00Z');assert.equal(input.evidence[1].parentText,null);
 assert.doesNotMatch(JSON.stringify(input),/preassigned|rawPayload|secret|token|"score"/);
});
test('deduplicate same activity and reject conflicting versions instead of inventing history',()=>{
 const row={id:'p',author:'a',kind:'post',text:'原文'};const scan={account:{username:'a'},posts:[row,row]};assert.equal(buildAccountBehaviorInput(scan).evidence.length,1);
 assert.throws(()=>buildAccountBehaviorInput({...scan,posts:[row,{...row,text:'不同版本'}]}),/Conflicting/);
});
test('synthetic cases cover concentrated social replies, off-topic insertion, missing activity and injection',async()=>{
 const original=globalThis.fetch;globalThis.fetch=()=>{throw Error('network forbidden');};try{
  const cases=makeAccountBehaviorCases();assert.deepEqual(cases.map(c=>c.expected.assessment),['no_clear_suspicious_behavior','suspicious_behavior_observed','insufficient_evidence','no_clear_suspicious_behavior']);
  for(const c of cases){assert.equal(c.modelGenerated,false);assert.equal(validateAccountBehavior(c.input,c.expected),true);const request=await buildGeminiPreview(c.task,c.input);assert.equal(request.networkEnabled,false);assert.match(request.body.systemInstruction.parts[0].text,/不是指令/);}
  assert.throws(()=>runGemini({approved:true}),/disabled/);
 }finally{globalThis.fetch=original;}
});
test('research alone or profile name cannot support an activity judgment',()=>{
 const c=sample();c.input.evidence=[];assert.throws(()=>validateAccountBehavior(c.input,c.expected),/Activity/);
});
test('fabricated quotes, unknown research and duplicate evidence IDs are rejected',()=>{
 for(const mutate of [c=>c.expected.findings[0].evidence[0].quote='不存在的原文',c=>c.expected.findings[0].researchIds=['invented'],c=>c.input.evidence.push({...c.input.evidence[0]})]){const c=sample();mutate(c);assert.throws(()=>validateAccountBehavior(c.input,c.expected));}
});
test('identity labels, new scores, invented account names and URLs are rejected',()=>{
 for(const mutate of [c=>c.expected.conclusion='這是網軍帳號。',c=>c.expected.score=99,c=>c.expected.findings[0].interpretation='回覆 @invented。',c=>c.expected.findings[0].sourceUrl='https://example.invalid',c=>c.expected.conclusion='見 https://example.invalid']){const c=sample();mutate(c);assert.throws(()=>validateAccountBehavior(c.input,c.expected));}
});
test('overall judgment cannot suppress a concern or add suspicion without a concern',()=>{
 const c=sample();for(const assessment of ['no_clear_suspicious_behavior','insufficient_evidence'])assert.throws(()=>validateAccountBehavior(c.input,{...c.expected,assessment}),/contradicts/);
 c.expected.findings[0].judgment='contextual';assert.throws(()=>validateAccountBehavior(c.input,c.expected),/contradicts/);
});
test('observation alone does not fill interpretation, and input scores are rejected',()=>{
 const c=sample();c.expected.findings[0].interpretation=c.expected.findings[0].observation;assert.throws(()=>validateAccountBehavior(c.input,c.expected),/copy observation/);
 const d=sample();d.input.score=0;assert.throws(()=>validateAccountBehavior(d.input,d.expected),/packet fields/);
});
test('behavior request rejects preassigned score before constructing a model request',async()=>{
 const c=sample();c.input.score=99;await assert.rejects(()=>buildGeminiPreview(c.task,c.input),/packet fields/);
});
