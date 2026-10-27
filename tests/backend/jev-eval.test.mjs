import test from 'node:test';
import assert from 'node:assert/strict';
import {makePreviewCases} from '../../scripts/preview-model.mjs';
import {composeCofacts,oracleCofacts,cofactsRequest,currentPair,slotRule,regexFlags,POLICY_CASES,confusion,Jev,PRICE} from '../../scripts/jev-eval.mjs';
import {normalizeText} from '../../server/analysis.mjs';

test('the code half of cofacts-relevance reproduces every human expected status from perfect atomic answers',()=>{
 const cases=makePreviewCases([]).filter(c=>c.task==='cofacts-relevance');assert.ok(cases.length>=18);
 for(const c of cases)assert.equal(composeCofacts(c.input,oracleCofacts(c)),c.expected.status,c.name);
});
test('cofacts request keeps source ids and kinds out of the model questions and names every source',()=>{
 const input={sentence:'青河市明天全市停水。',lookupStatus:'completed',sources:[{id:'secret-id',kind:'factcheck_reply',text:'範圍只有東區。'}]};
 const {state,questions}=cofactsRequest(input);
 assert.deepEqual(Object.keys(state.sources),['source_1']);assert.ok(!JSON.stringify(questions).includes('secret-id'));
 assert.deepEqual(Object.keys(questions.relation_1.criteria),['same','different','unclear']);
});
test('a name-swapped slogan is missed by today\'s pair rules and caught by the slot rule; unrelated posts are not',()=>{
 const [a,b]=['Lie神不倒 台灣不會好','G邁不倒 高雄不會好'].map(normalizeText);
 assert.equal(currentPair(a,b),null);assert.equal(slotRule(a,b),true);
 assert.equal(slotRule(normalizeText('🇹🇼高金素梅加油🇹🇼'),normalizeText('🇹🇼藍軍加油🇹🇼')),true);
 assert.equal(slotRule(normalizeText('今天天氣很好'),normalizeText('晚餐吃拉麵配煎餃')),false);
});
test('the regex gate agrees with every policy test case',()=>{for(const [text,label] of POLICY_CASES)assert.equal(regexFlags(text),label,text);});
test('confusion skips unlabelled rows and decisions',()=>{
 assert.deepEqual(confusion([{label:true,d:true},{label:false,d:true},{label:null,d:true},{label:true,d:null}],r=>r.d),{tp:1,fp:1,fn:0,tn:0,precision:.5,recall:1});
});
test('a dry run never touches the network and a live run stops at the budget',async t=>{
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;delete process.env.TYPESAFE_API_KEY;});
 globalThis.fetch=()=>{throw Error('network forbidden in dry run')};
 const dry=await new Jev().ask({text:'x'},{q:{type:'noul',instructions:'?'}});assert.equal(dry.dry,true);assert.ok(dry.estimate>0);
 let calls=0;process.env.TYPESAFE_API_KEY='test-key-not-real';
 globalThis.fetch=async(url,init)=>{calls++;assert.equal(url,'https://api.typesafe.ai/v1/systemone');assert.equal(init.headers.authorization,'Bearer test-key-not-real');
  return new Response(JSON.stringify({model:'jev-1.14.0',answers:{q:{type:'noul',noul:.9}},usage:{input_tokens:1000}}),{status:200});};
 const jev=new Jev({live:true,maxUsd:PRICE.jev.in*1010/1e6});
 const first=await jev.ask({text:'x'},{q:{type:'noul',instructions:'?'}});assert.equal(first.answers.q.noul,.9);assert.equal(first.tokens,1000);
 const second=await jev.ask({text:'x'},{q:{type:'noul',instructions:'?'}});assert.equal(second.skipped,'budget');assert.equal(calls,1);
 assert.equal(jev.stats().calls,1);
});
