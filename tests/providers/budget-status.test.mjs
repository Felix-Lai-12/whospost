import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchAccount} from '../../server/providers/index.mjs';
import {Store} from '../../server/store.mjs';
import {createApp} from '../../server/http.mjs';
const response=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
const budgetError=()=>Object.assign(new Error('fixture budget blocked'),{code:'BUDGET_EXCEEDED'});
async function withFixtureToken(fn){const prior=process.env.APIFY_TOKEN;process.env.APIFY_TOKEN='fixture-only-not-a-real-token';try{return await fn();}finally{if(prior===undefined)delete process.env.APIFY_TOKEN;else process.env.APIFY_TOKEN=prior;}}

test('budget blocks all dispatches: provider rejects and never searches claims or starts network requests',()=>withFixtureToken(async()=>{
 let requests=0;const budget={reserve(){throw budgetError();},settle(){throw Error('no settle');}};
 await assert.rejects(()=>fetchAccount('hkj331155',{settlePollMs:0,state:{scanId:'fixture'},budget,fetchImpl:async()=>{requests++;throw Error('must not request');}}),error=>{
  assert.equal(error.code,'BUDGET_EXCEEDED');assert.equal(error.collection.status,'blocked');
  assert.ok(error.collection.steps.every(step=>step.status==='not_executed'));return true;
 });
 assert.equal(requests,0);
}));

test('existing saved job survives new budget blocks and returns partial evidence without new POSTs',()=>withFixtureToken(async()=>{
 let starts=0;
 const raw={type:'post',postId:'saved',username:'tester',text:'已保存來源的足夠長原創內容可進行描述但不應因後續預算不足丟掉',date:'2026-10-17T00:00:00Z',url:'https://www.threads.com/@tester/post/saved'};
 const bundle=await fetchAccount('tester',{settlePollMs:0,state:{scanId:'fixture',jobs:{posts:{runId:'existing',dispatched:true,reservedKey:'fixture:posts'}}},budget:{reserve(){throw budgetError();},settle(){}},fetchImpl:async(url,init={})=>{
  if(init.method==='POST'){starts++;throw Error('no POST allowed');}
  return url.includes('/actor-runs/')?response({data:{id:'existing',status:'SUCCEEDED',defaultDatasetId:'saved',usageTotalUsd:.01}}):response([raw]);
 }});
 assert.equal(starts,0);assert.equal(bundle.posts.length,1);assert.equal(bundle.collection.status,'partial');
 assert.equal(bundle.collection.errorCode,'BUDGET_EXCEEDED');assert.ok(bundle.limitations.some(v=>v.includes('不能據此判定帳號沒有內容')));
}));

test('HTTP run stores budget-blocked as failed/not-executed, null score, never completed/no-claim',async()=>{
 const store=new Store(':memory:');const scan=store.create('tester');
 const app=createApp({store,fetchAccount:async()=>{const error=budgetError();error.collection={status:'blocked',errorCode:'BUDGET_EXCEEDED',steps:[{key:'posts',status:'not_executed',errorCode:'BUDGET_EXCEEDED'}]};throw error;}});
 try{await app.run(scan.id);const result=store.get(scan.id);
  assert.equal(result.status,'failed');assert.equal(result.error.code,'BUDGET_EXCEEDED');
  assert.equal(result.score.value,null);assert.equal(result.collection.status,'blocked');
  assert.equal(result.analysis.factChecks.status,'not_executed');assert.match(result.progress,/取數未完成/);
  assert.equal(store.cacheGet('scan:tester'),null);
 }finally{store.close();}
});

test('HTTP partial bundle preserves content and explicit collection reason in saved analysis',async()=>{
 const store=new Store(':memory:');const scan=store.create('tester');
 const collection={status:'partial',errorCode:'BUDGET_EXCEEDED',reason:'本人留言任務未執行',steps:[]};
 const app=createApp({store,fetchAccount:async()=>({account:scan.account,posts:[{id:'p',kind:'post',author:'tester',text:'已取得的原創貼文不能因後續另一個取數任務預算不足而丟掉',postedAt:'2026-10-17T00:00:00Z',url:'https://www.threads.com/@tester/post/p',source:'fixture'}],comments:[],commentsAvailable:false,collection})});
 try{await app.run(scan.id);const result=store.get(scan.id);assert.equal(result.status,'completed');
  assert.equal(result.posts.length,1);assert.deepEqual(result.collection,collection);assert.match(result.progress,/部分分析完成/);
  assert.deepEqual(store.cacheGet('scan:tester').collection,collection);
 }finally{store.close();}
});
