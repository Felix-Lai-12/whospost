import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {StoreObjectCore,remoteStore} from '../../worker/store-object.mjs';
import {ScanJobCore} from '../../worker/scan-object.mjs';
import {createWorkerApp} from '../../worker/app.mjs';
import {collectionProfile} from '../../server/collection-profile.mjs';

// Minimal Durable Object storage: SQL over node:sqlite plus key-value and alarm.
function fakeStorage(){
 const db=new DatabaseSync(':memory:'),kv=new Map();let alarm=null;
 return {
  sql:{exec(text,...params){const rows=db.prepare(text).all(...params);return {toArray:()=>rows,one:()=>rows[0]};}},
  transactionSync(fn){db.exec('BEGIN');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}},
  setAlarm(t){alarm=t;},getAlarm:()=>alarm,
  async get(k){return kv.get(k);},async put(k,v){if(typeof k==='object')for(const [a,b] of Object.entries(k))kv.set(a,b);else kv.set(k,v);},async delete(k){for(const key of [k].flat())kv.delete(key);}
 };
}
const ENV={WHOSPOST_APIFY_LIMIT_USD:'2',WHOSPOST_DAILY_LIMIT_USD:'1',WHOSPOST_AI_LIMIT_USD:'1',WHOSPOST_AI_ENABLED:'1',GEMINI_API_KEY:'fixture-key'};
const dataObject=(env=ENV,options={})=>{const ctx={storage:fakeStorage()};return {ctx,core:new StoreObjectCore(ctx,env,{prompt:'fixture prompt',...options})};};
const profile=collectionProfile('standard');
const bundle=username=>({account:{username,url:`https://www.threads.com/@${username}`,name:null},posts:[{id:'p1',author:username,kind:'post',text:'今天天氣很好',postedAt:'2026-10-01T00:00:00Z',url:`https://www.threads.com/@${username}/post/p1`}],comments:[],comparison:[],comparedTargetIds:[],commentsAvailable:false});

test('data object shares one SQLite: per-IP daily quota and daily spend cap are atomic',()=>{
 const {core}=dataObject();
 const ask=(u,ip='ip-a',estimateUsd=.3)=>core.requestScan(u,profile,{configured:true,quota:{ip,max:3},estimateUsd});
 for(const u of ['sample_a','sample_b','sample_c'])assert.equal(ask(u).status,202);
 assert.deepEqual([ask('sample_d').status,ask('sample_d').body.code],[429,'DAILY_QUOTA']);
 assert.equal(ask('sample_d','ip-b').status,202,'another address keeps its own quota');
 // A pending scan is reused without counting again.
 assert.equal(ask('sample_a','ip-c').status,202);
 assert.equal(core.budgetReserve('x:posts',.8).ok,true);
 assert.deepEqual([ask('sample_e','ip-d').status,ask('sample_e','ip-d').body.code],[429,'DAILY_BUDGET_EXCEEDED']);
 assert.deepEqual(core.budgetReserve('x:replies',.3),{ok:false,code:'BUDGET_EXCEEDED',message:'今天的查詢額度已用完，未啟動新任務。'});
 assert.equal(core.dailySummary().committed,.8);
});

test('AI reservations count toward the same daily cap as Apify',async()=>{
 let generated=0;
 const fetchImpl=async url=>({ok:true,json:async()=>url.endsWith('countTokens')?{totalTokens:400}:(generated++,{})});
 const {core,ctx}=dataObject(ENV,{fetchImpl});
 const scan=core.store.create('sample_ai');core.store.update(scan.id,{status:'completed',posts:bundle('sample_ai').posts});
 core.budgetReserve('y:posts',.995);
 assert.equal(core.aiStart(scan.id).result.status,'processing');
 assert.notEqual(ctx.storage.getAlarm(),null,'generation waits for the alarm');
 await core.alarm();
 assert.equal(generated,0,'over the shared daily cap, Gemini is never called');
 assert.equal(core.aiInspect(scan.id).result.status,'budget_exceeded');
});

test('scan job runs through the data object, then starts shared AI once',async()=>{
 const {core}=dataObject();const calls=[];
 const stub=new Proxy(core,{get:(t,k)=>typeof t[k]==='function'?(...a)=>{calls.push(k);return Promise.resolve(t[k](...a));}:t[k]});
 const decision=core.requestScan('sample_job',profile,{configured:true,estimateUsd:.3});
 const job=new ScanJobCore({storage:fakeStorage()},{APIFY_TOKEN:'fixture-only'},{storeStub:stub,fetchAccount:async(username,{budget,onState,token})=>{assert.equal(token,'fixture-only');await budget.reserve(`${decision.run}:posts`,.1);await onState({jobs:{posts:{runId:'fixture-run'}}});return bundle(username);}});
 await job.start(decision.run);await job.start(decision.run);
 assert.equal((await job.alarm()).status,'completed');
 const view=core.scanView(decision.run);
 assert.equal(view.status,'completed');assert.equal(core.getState(decision.run).jobs.posts.runId,'fixture-run');
 assert.ok(calls.includes('aiStart'));
 assert.equal(await job.alarm(),undefined,'a finished job does not run again');
});

test('pending Apify work is resumed by a later alarm instead of failing',async()=>{
 const {core}=dataObject();const storage=fakeStorage();let now=1000;
 const decision=core.requestScan('sample_wait',profile,{configured:true,estimateUsd:.3});
 const job=new ScanJobCore({storage},{},{storeStub:core,now:()=>now,fetchAccount:async()=>{throw Object.assign(Error('pending'),{code:'APIFY_PENDING'});}});
 await job.start(decision.run);await job.alarm();
 assert.equal(core.get(decision.run).status,'running');assert.equal(storage.getAlarm(),4000);
 assert.equal(core.get(decision.run).progress,'Apify 任務仍在處理，稍後自動繼續','never reported as failed between alarms');
});

test('remote store turns budget refusals back into coded errors for the runner',async()=>{
 const store=remoteStore({budgetReserve:async()=>({ok:false,code:'BUDGET_EXCEEDED',message:'no'})});
 await assert.rejects(()=>store.budget.reserve('k',1),e=>e.code==='BUDGET_EXCEEDED');
});

test('worker gate: kill switch, rate limit, Turnstile, hashed IP quota; public AI POST only reads',async()=>{
 const {core}=dataObject();let limited=false,verified=[];const started=[];
 const env={...ENV,APIFY_TOKEN:'fixture-only',TURNSTILE_SECRET:'test-secret',TURNSTILE_HOSTNAMES:'whospost.example',IP_HASH_SALT:'salt',WHOSPOST_IP_DAILY_SCANS:'1',TURNSTILE_SITE_KEY:'site',SCAN_RATE_LIMITER:{limit:async()=>({success:!limited})},ASSETS:{fetch:async()=>new Response('asset')}};
 const fetchImpl=async(url,{body})=>{verified.push(body.get('remoteip'));return {ok:true,json:async()=>({success:body.get('response')==='good',action:'scan',hostname:'whospost.example'})};};
 const app=createWorkerApp(env,{storeStub:core,startScan:id=>{started.push(id);},fetchImpl});
 const post=(body,headers={})=>app(new Request('https://whospost.example/api/scans',{method:'POST',headers:{'Content-Type':'application/json','cf-connecting-ip':'203.0.113.9',...headers},body:JSON.stringify(body)}));
 assert.equal((await post({url:'https://www.threads.com/@sample_one'})).status,403);
 const ok=await post({url:'https://www.threads.com/@sample_one',turnstileToken:'good'});assert.equal(ok.status,202);assert.equal(started.length,1);
 assert.deepEqual(verified,['203.0.113.9']);
 assert.equal(core.store.db.prepare('SELECT ip FROM ip_quota').all().some(r=>r.ip.includes('203')),false,'raw IP is never stored');
 assert.equal((await (await post({url:'https://www.threads.com/@sample_two',turnstileToken:'good'})).json()).code,'DAILY_QUOTA');
 limited=true;assert.equal((await post({url:'https://www.threads.com/@sample_two',turnstileToken:'good'})).status,429);limited=false;
 const paused=createWorkerApp({...env,WHOSPOST_SCANS_ENABLED:'0'},{storeStub:core,startScan:()=>{}});
 assert.equal((await paused(new Request('https://whospost.example/api/scans',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"url":"https://www.threads.com/@sample_three"}'}))).status,503);
 const health=await (await app(new Request('https://whospost.example/api/health'))).json();
 assert.deepEqual([health.turnstileSiteKey,health.daily.limit,health.scansEnabled],['site',1,true]);
 const aiPost=await app(new Request(`https://whospost.example/api/scans/${started[0]}/ai`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}));
 assert.equal(aiPost.status,200);assert.equal((await aiPost.json()).status,'scan_not_ready');
 assert.equal(await (await app(new Request('https://whospost.example/'))).text(),'asset');
});

test('admin import needs the exact token and never imports spend ledgers',async()=>{
 const {core}=dataObject();
 const app=createWorkerApp({...ENV,ADMIN_TOKEN:'admin-fixture',ASSETS:{fetch:async()=>new Response('')}},{storeStub:core,startScan:()=>{}});
 const seed={scans:[{id:'s1',username:'sample_seed',status:'completed',created_at:'2026-10-01',updated_at:'2026-10-01',result_json:JSON.stringify({id:'s1',status:'completed',account:{username:'sample_seed'},posts:[],comments:[]}),provider_state_json:'{}'}],budget:[{key:'x',reserved:9}]};
 const send=token=>app(new Request('https://whospost.example/api/admin/import',{method:'POST',headers:{authorization:`Bearer ${token}`},body:JSON.stringify(seed)}));
 assert.equal((await send('wrong')).status,401);
 assert.equal((await (await send('admin-fixture')).json()).scans,1);
 assert.equal(core.budgetSummary().committed,0);
 const closed=createWorkerApp({...ENV,ASSETS:{fetch:async()=>new Response('')}},{storeStub:core,startScan:()=>{}});
 assert.equal((await closed(new Request('https://whospost.example/api/admin/import',{method:'POST',body:'{}'}))).status,404);
});

test('admin release drops a dispatch that never got a run ID, frees its reservation and lets the scan restart',async()=>{
 const {core}=dataObject();
 const app=createWorkerApp({...ENV,ADMIN_TOKEN:'admin-fixture',ASSETS:{fetch:async()=>new Response('')}},{storeStub:core,startScan:()=>{}});
 const id=core.requestScan('sample_stuck',profile,{configured:true,estimateUsd:.3}).body.id;
 core.budgetReserve(`${id}:posts`,.1);
 core.setState(id,{jobs:{posts:{dispatched:true,reservedKey:`${id}:posts`,status:'DISPATCHING'},replies:{dispatched:true,runId:'run1',reservedKey:`${id}:replies`}}});
 core.update(id,{status:'failed'});
 assert.ok(core.dailySummary().committed>=.1);
 const send=(token,scan=id)=>app(new Request(`https://whospost.example/api/admin/scans/${scan}/release-dispatch`,{method:'POST',headers:{authorization:`Bearer ${token}`}}));
 assert.equal((await send('wrong')).status,401);
 assert.equal((await send('admin-fixture','missing')).status,404);
 assert.deepEqual((await (await send('admin-fixture')).json()).released,['posts']);
 assert.deepEqual(Object.keys(core.getState(id).jobs),['replies']);
 assert.equal(core.dailySummary().committed,0);
 assert.equal(core.requestScan('sample_stuck',profile,{configured:true,estimateUsd:.3}).status,202);
});
test('scan alarm catches its own errors, backs off, then marks the scan failed',async()=>{
 const {core}=dataObject();const storage=fakeStorage();let now=0;
 const decision=core.requestScan('sample_err',profile,{configured:true,estimateUsd:.3});
 const broken=new Proxy(core,{get:(t,k)=>k==='get'?()=>{throw Error('data object unavailable');}:t[k]});
 const job=new ScanJobCore({storage},{},{storeStub:broken,now:()=>now,fetchAccount:async()=>bundle('sample_err')});
 await job.start(decision.run);
 const delays=[];for(let i=0;i<5;i++){assert.equal((await job.alarm()).status,'retrying');delays.push(storage.getAlarm());}
 assert.deepEqual(delays,[4000,8000,16000,32000,60000]);
 assert.deepEqual(await job.alarm(),{status:'failed',code:'PROVIDER_FAILED'});
 assert.equal(core.get(decision.run).status,'failed');
});

test('an alarm firing again for a finished scan does not fetch twice',async()=>{
 const {core}=dataObject();let fetches=0;
 const decision=core.requestScan('sample_twice',profile,{configured:true,estimateUsd:.3});
 const storage=fakeStorage(),job=new ScanJobCore({storage},{},{storeStub:core,fetchAccount:async u=>{fetches++;return bundle(u);}});
 await job.start(decision.run);await job.alarm();
 await storage.put('scanId',decision.run);await job.alarm();
 assert.equal(fetches,1);
});

test('Turnstile result must carry the scan action and an allowed hostname; test keys only when allowed',async()=>{
 const reply={};const fetchImpl=async()=>({ok:true,json:async()=>reply});
 const base={...ENV,APIFY_TOKEN:'fixture-only',TURNSTILE_SECRET:'s',TURNSTILE_HOSTNAMES:'whospost.example',ASSETS:{fetch:async()=>new Response('')}};
 const tryWith=async(env,value)=>{Object.assign(reply,{success:undefined,action:undefined,hostname:undefined,metadata:undefined},value);const {core}=dataObject();const app=createWorkerApp(env,{storeStub:core,startScan:()=>{},fetchImpl});return (await app(new Request('https://whospost.example/api/scans',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:'https://www.threads.com/@sample_t',turnstileToken:'t'})}))).status;};
 assert.equal(await tryWith(base,{success:true,action:'scan',hostname:'whospost.example'}),202);
 assert.equal(await tryWith(base,{success:true,action:'login',hostname:'whospost.example'}),403);
 assert.equal(await tryWith(base,{success:true,action:'scan',hostname:'evil.example'}),403);
 const testKey={success:true,hostname:'example.com',metadata:{result_with_testing_key:true}};
 assert.equal(await tryWith({...base,TURNSTILE_HOSTNAMES:'example.com'},testKey),403);
 assert.equal(await tryWith({...base,TURNSTILE_HOSTNAMES:'example.com',TURNSTILE_ALLOW_TEST_KEY:'1'},testKey),202);
 assert.equal(await tryWith({...base,TURNSTILE_HOSTNAMES:''},{success:true,action:'scan',hostname:'whospost.example'}),503);
});

test('request bodies are read with a byte limit, never fully buffered when oversized',async()=>{
 const {core}=dataObject();const app=createWorkerApp({...ENV,ASSETS:{fetch:async()=>new Response('')}},{storeStub:core,startScan:()=>{}});
 let pulled=0;const stream=new ReadableStream({pull(c){pulled++;c.enqueue(new Uint8Array(4096));if(pulled>1000)c.close();}});
 const r=await app(new Request('https://whospost.example/api/scans',{method:'POST',headers:{'Content-Type':'application/json'},body:stream,duplex:'half'}));
 assert.equal(r.status,413);assert.ok(pulled<10,`read ${pulled} chunks`);
});

test('finished results are served from the isolate cache; running scans are not cached',async()=>{
 const {core}=dataObject();let views=0;
 const stub=new Proxy(core,{get:(t,k)=>k==='scanView'?id=>{views++;return t.scanView(id);}:t[k]});
 const app=createWorkerApp({...ENV,ASSETS:{fetch:async()=>new Response('')}},{storeStub:stub,startScan:()=>{}});
 const done=core.store.create('sample_cache');core.store.update(done.id,{status:'completed'});
 const running=core.store.create('sample_live');
 for(let i=0;i<3;i++){await app(new Request(`https://whospost.example/api/scans/${done.id}`));await app(new Request(`https://whospost.example/api/scans/${running.id}`));}
 assert.equal(views,4);
});
test('every data-object method is exposed by the Durable Object class',async()=>{
 const {readFileSync}=await import('node:fs');
 const entry=readFileSync(new URL('../../worker/index.mjs',import.meta.url),'utf8');
 const missing=Object.getOwnPropertyNames(StoreObjectCore.prototype).filter(m=>m!=='constructor'&&!entry.includes(`this.core.${m}(`));
 assert.deepEqual(missing,[]);
});
