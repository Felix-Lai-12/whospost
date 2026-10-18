import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../../server/store.mjs';
import {collectionProfile,coversProfile} from '../../server/collection-profile.mjs';
import {validateBehaviorClaims} from '../../server/ai/semantic-policy.mjs';

test('apify budget limit is configurable and keeps prior commitments',()=>{
 const legacy=new Store(':memory:');
 assert.equal(legacy.budget.summary().limit,1);
 legacy.budget.reserve('old',.95);
 assert.throws(()=>legacy.budget.reserve('next',.10),{code:'BUDGET_EXCEEDED'});
 const raised=new Store(':memory:',{budgetLimitUsd:1.80});
 raised.budget.reserve('old',.95);
 for(const [key,amount] of [['posts',.10],['replies',.25],['search',.30],['searchRelaxed',.20]])raised.budget.reserve(key,amount);
 assert.deepEqual(raised.budget.summary(),{limit:1.8,committed:1.8,spent:0});
 assert.throws(()=>raised.budget.reserve('extra',.01),{code:'BUDGET_EXCEEDED'});
 assert.throws(()=>new Store(':memory:',{budgetLimitUsd:NaN}));
});

test('acceptance profile covers standard requests but not the reverse',()=>{
 const standard=collectionProfile('standard'),acceptance=collectionProfile('acceptance-30-100');
 assert.deepEqual([acceptance.posts,acceptance.replies,acceptance.replyScope],[30,100,'all_authored']);
 assert.equal(coversProfile({collectionRequest:acceptance},standard),true);
 assert.equal(coversProfile({},acceptance),false);
 assert.throws(()=>collectionProfile('unknown'));
});

const input={evidence:[{id:'r1',text:'讚讚讚',parentUrl:'https://www.threads.com/@x/post/1',parentText:null}],coverage:{sampleOnly:true}};
const output=text=>({conclusion:text,findings:[{behavior:'重複短句',observation:'同串連續留言',interpretation:'可見反覆聲援',alternative:'也可能只是熟人互動'}]});

test('semantic policy blocks unsupported intent, relevance and full-history claims',()=>{
 for(const [text,problem] of [['符合人為刷量的特徵','unsupported_intent_or_operator'],['可能是人為刷量','unsupported_intent_or_operator'],['留言與原串無關','missing_parent_context'],['帳號全天候發言','sample_as_full_history']])
  assert.throws(()=>validateBehaviorClaims(input,output(text)),e=>e.code==='SEMANTIC_POLICY_FAILED'&&e.problems.includes(problem));
});

test('semantic policy allows negated claims and observable descriptions',()=>{
 assert.doesNotThrow(()=>validateBehaviorClaims(input,output('沒有證據顯示人為刷量，本次可見留言集中回覆同一作者')));
 assert.doesNotThrow(()=>validateBehaviorClaims(input,output('同串數秒內連續送出重複短句，呈現可見反覆聲援')));
});

test('final settlement releases the unused reservation; provisional actuals keep it',()=>{
 const s=new Store(':memory:',{budgetLimitUsd:1});
 s.budget.reserve('a',.30);s.budget.reserve('b',.30);
 s.budget.settle('a',.02);
 assert.deepEqual(s.budget.summary(),{limit:1,committed:.6,spent:.02});
 s.budget.settle('a',.06,{final:true});
 assert.deepEqual(s.budget.summary(),{limit:1,committed:.36,spent:.06});
 s.budget.reserve('c',.60);
 assert.throws(()=>s.budget.reserve('d',.10),{code:'BUDGET_EXCEEDED'});
});

test('reconcile settles only stable, fully billed runs and keeps unknown rows reserved',async()=>{
 const {reconcileBudget}=await import('../../scripts/reconcile-budget.mjs');
 const s=new Store(':memory:',{budgetLimitUsd:2});const scan=s.create('tester');
 for(const [k,v] of [['posts',.10],['replies',.25],['search',.30],['orphan',.20]])s.budget.reserve(`${scan.id}:${k}`,v);
 s.setState(scan.id,{jobs:{posts:{reservedKey:`${scan.id}:posts`,runId:'p'},replies:{reservedKey:`${scan.id}:replies`,runId:'r'},search:{reservedKey:`${scan.id}:search`,runId:'s'}}});
 let replyReads=0;
 const runs={p:()=>({status:'SUCCEEDED',usageTotalUsd:.06005,defaultDatasetId:'dp',chargedEventCounts:{'apify-default-dataset-item':30}}),r:()=>({status:'SUCCEEDED',usageTotalUsd:++replyReads>1?.14:.03,defaultDatasetId:'dr'}),s:()=>({status:'SUCCEEDED',usageTotalUsd:.02,defaultDatasetId:'ds',chargedEventCounts:{start:1,post:0}})};
 const fetchImpl=async url=>{const m=url.match(/actor-runs\/(\w+)/),d=url.match(/datasets\/(\w+)/);return {json:async()=>({data:m?runs[m[1]]():{itemCount:d[1]==='dp'?30:0}})}};
 const {report,summary}=await reconcileBudget(s,{fetchImpl,token:'t',sleep:async()=>{}});
 assert.deepEqual(report.map(r=>[r.key.split(':')[1],r.status]),[['posts','settled'],['replies','kept_reserved'],['search','settled'],['orphan','kept_reserved']]);
 assert.deepEqual(summary,{limit:2,committed:Number((.06005+.25+.02+.20).toFixed(6)),spent:.08005});
});
