import test from 'node:test';
import assert from 'node:assert/strict';
import {createApifyUsage,APIFY_LIMITS_URL} from '../../worker/apify-usage.mjs';
import {createWorkerApp} from '../../worker/app.mjs';
import {StoreObjectCore} from '../../worker/store-object.mjs';
import {scanOutcome} from '../../frontend/src/analytics.mjs';
import {DatabaseSync} from 'node:sqlite';

function fakeStorage(){
 const db=new DatabaseSync(':memory:'),kv=new Map();let alarm=null;
 return {sql:{exec(text,...params){const rows=db.prepare(text).all(...params);return {toArray:()=>rows,one:()=>rows[0]};}},transactionSync(fn){db.exec('BEGIN');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}},setAlarm(t){alarm=t;},getAlarm:()=>alarm,async get(k){return kv.get(k);},async put(k,v){kv.set(k,v);},async delete(k){kv.delete(k);}};
}
const limits=(used,limit)=>({data:{monthlyUsageCycle:{startAt:'2026-10-01T00:00:00.000Z',endAt:'2026-10-31T23:59:59.999Z'},current:{monthlyUsageUsd:used},limits:{maxMonthlyUsageUsd:limit}}});
// A Worker with Turnstile always passing; `apify` decides what GET /v2/users/me/limits answers (a body, a status or a thrown error).
function worker(apify,{clock}={}){
 const core=new StoreObjectCore({storage:fakeStorage()},{WHOSPOST_APIFY_LIMIT_USD:'5',WHOSPOST_DAILY_LIMIT_USD:'0',WHOSPOST_AI_LIMIT_USD:'1',WHOSPOST_COLLECTION_PROFILE:'standard-25'},{prompt:'fixture prompt'});
 const calls=[],started=[],silent={warn(){calls.push('warn');}};
 const fetchImpl=async(url,init)=>{
  if(url===APIFY_LIMITS_URL){calls.push(init.headers.Authorization);const a=await apify();return a instanceof Response?a:Response.json(a);}
  return Response.json({success:true,action:'scan',hostname:'whospost.example'});
 };
 const env={APIFY_TOKEN:'tok-fixture',WHOSPOST_COLLECTION_PROFILE:'standard-25',TURNSTILE_SECRET:'s',TURNSTILE_HOSTNAMES:'whospost.example',WHOSPOST_IP_DAILY_SCANS:'50',ASSETS:{fetch:async()=>new Response('')}};
 const app=createWorkerApp(env,{storeStub:core,startScan:id=>started.push(id),fetchImpl,now:clock??Date.now});
 const post=user=>app(new Request('https://whospost.example/api/scans',{method:'POST',headers:{'Content-Type':'application/json','cf-connecting-ip':'203.0.113.5'},body:JSON.stringify({url:`https://www.threads.com/@${user}`,turnstileToken:'good'})}));
 const health=async()=>(await app(new Request('https://whospost.example/api/health'))).json();
 return {post,health,calls,started,core,silent};
}

test('Apify account over its monthly limit: new scans get 429 BUDGET_EXCEEDED, which the frontend treats as quota; saved results still open',async()=>{
 const w=worker(()=>limits(5.5,5));
 const refused=await w.post('sample_over');
 assert.equal(refused.status,429);
 const body=await refused.json();
 assert.equal(body.code,'BUDGET_EXCEEDED');
 assert.match(body.error,/小額捐款 100 元/);
 assert.equal(scanOutcome(refused.status,body.code),'quota');
 assert.deepEqual(w.started,[]);
 assert.equal(w.core.store.db.prepare('SELECT COUNT(*) n FROM scans').get().n,0,'nothing is reserved or created');
 // An account that was scanned earlier is still served from the store without touching Apify.
 const saved=w.core.store.create('seen_before');w.core.store.update(saved.id,{status:'completed',posts:[{id:'p1',author:'seen_before',text:'x'}],collectionRequest:{id:'standard-25',posts:10,replies:25,replyScope:'other_threads'}});
 const cached=await w.post('seen_before');assert.equal(cached.status,200);assert.equal((await cached.json()).cached,true);
 const health=await w.health();
 assert.deepEqual([health.apifyMonthly.used,health.apifyMonthly.limit,health.apifyMonthly.ok,health.apifyMonthly.cycleEndsAt],[5.5,5,true,'2026-10-31T23:59:59.999Z']);
 assert.equal(JSON.stringify(health).includes('tok-fixture'),false,'the token never reaches the health answer');
});

test('remaining budget smaller than one scan estimate also refuses; enough remaining lets the scan start',async()=>{
 // standard-25 estimates 0.15 per scan: 4.90/5 leaves 0.10, not enough; 4.80/5 leaves 0.20, enough.
 const tight=worker(()=>limits(4.9,5));
 assert.equal((await tight.post('sample_tight')).status,429);
 const fine=worker(()=>limits(4.8,5));
 const ok=await fine.post('sample_fine');
 assert.equal(ok.status,202);assert.equal(fine.started.length,1);
 assert.deepEqual(fine.calls,['Bearer tok-fixture'],'limits are read with the existing token');
});

test('Apify API failure, timeout or odd body fails open: the scan proceeds on the site ledger and the failure is logged',async()=>{
 for(const answer of [()=>new Response('nope',{status:500}),()=>{throw Object.assign(Error('timeout'),{name:'TimeoutError'});},()=>({data:{current:{},limits:{}}}),()=>({data:{current:{monthlyUsageUsd:9},limits:{maxMonthlyUsageUsd:0}}})]){
  const w=worker(answer);
  const r=await w.post('sample_open');
  assert.equal(r.status,202,'fail open');
  const health=await w.health();
  assert.equal(health.apifyMonthly.used===null||health.apifyMonthly.limit===0,true);
 }
 const logs=[];const usage=createApifyUsage({token:'t',fetchImpl:async()=>new Response('',{status:503}),log:{warn:m=>logs.push(m)}});
 assert.equal(await usage.exhausted(1),false);
 assert.equal(logs.length,1);assert.match(logs[0],/apify usage check failed/);assert.equal(logs[0].includes('t"'),false);
});

test('the Apify answer is cached for 60 seconds per Worker isolate, success and failure alike',async()=>{
 let t=1_000_000,answer=limits(5.5,5),hits=0;
 const usage=createApifyUsage({token:'t',fetchImpl:async()=>{hits++;return Response.json(answer);},now:()=>t,log:{warn(){}}});
 assert.equal(await usage.exhausted(.15),true);
 answer=limits(0,5);
 assert.equal(await usage.exhausted(.15),true,'still refused from cache');
 t+=59_000;assert.equal(await usage.exhausted(.15),true);assert.equal(hits,1);
 t+=1_001;assert.equal(await usage.exhausted(.15),false,'re-read after the TTL: limit reset or raised, scans resume on their own');
 assert.equal(hits,2);
 // A failed read is cached too, so a down Apify does not add a request to every submission.
 let fail=0;const broken=createApifyUsage({token:'t',fetchImpl:async()=>{fail++;throw Error('down');},now:()=>t,log:{warn(){}}});
 await broken.exhausted(1);await broken.exhausted(1);assert.equal(fail,1);
 // No token: never calls out.
 let none=0;const untokened=createApifyUsage({token:'',fetchImpl:async()=>{none++;}});
 assert.equal(await untokened.exhausted(1),false);assert.equal(none,0);
});

test('a Worker gate end to end: the same request is refused, then admitted after the cycle resets, without redeploying',async()=>{
 let t=5_000_000,answer=limits(5.2,5);
 const w=worker(()=>answer,{clock:()=>t});
 assert.equal((await w.post('sample_cycle')).status,429);
 answer=limits(0.1,5);t+=61_000;
 assert.equal((await w.post('sample_cycle')).status,202);
});
