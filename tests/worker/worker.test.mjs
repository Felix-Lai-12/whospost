import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {StoreObjectCore,remoteStore} from '../../worker/store-object.mjs';
import {ScanJobCore} from '../../worker/scan-object.mjs';
import {createWorkerApp} from '../../worker/app.mjs';
import {collectionProfile} from '../../server/collection-profile.mjs';
import {fetchAccount,settleBills} from '../../server/providers/index.mjs';

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
// Fake Apify: a run is still running when it starts and has finished by the first long poll. Each request is
// logged, so a test can tell the long polls (wait:), the rows (rows:) and later plain reads for bills (read:) apart.
function fakeApify(username,{usage=.04}={}){
 const log=[],modes={};let n=0;
 const row=(kind,id)=>({record_type:kind,id,username,text:`這是一篇有足夠長度的公開技術教學分享內容${id}`,url:`https://www.threads.com/@${username}/post/${id}`,posted_at:'2026-10-17T00:00:00Z',is_reply:kind==='reply',...(kind==='reply'?{reply_to_url:'https://www.threads.com/@other/post/parent',reply_to_author:'other'}:{})});
 return {log,fetchImpl:async(url,init={})=>{
  if(url.includes('cofacts'))return Response.json({data:{ListArticles:{edges:[]}}});
  if(init.method==='POST'){const {mode}=JSON.parse(init.body);const id=`${mode}-${++n}`;modes[id]=mode;log.push(`start:${mode}`);return Response.json({data:{id,status:'RUNNING',defaultDatasetId:id,usageTotalUsd:.001}});}
  if(url.includes('/actor-runs/')){const id=decodeURIComponent(url.split('/').pop().split('?')[0]);log.push(`${url.includes('waitForFinish=')?'wait':'read'}:${modes[id]}`);return Response.json({data:{id,status:'SUCCEEDED',defaultDatasetId:id,usageTotalUsd:usage}});}
  const id=url.match(/datasets\/([^/]+)/)[1];log.push(`rows:${modes[id]}`);return Response.json([row(modes[id]==='posts'?'post':'reply',id)]);
 }};
}
// A scan job wired to the real provider code over the fake Apify, as worker/index.mjs wires it to the real one.
const apifyJob=(storage,storeStub,apify,{now=()=>0,fetch=fetchAccount,settle=settleBills}={})=>new ScanJobCore({storage},{APIFY_TOKEN:'fixture-only'},{storeStub,now,
 fetchAccount:(username,options)=>fetch(username,{...options,fetchImpl:apify.fetchImpl}),
 settleBills:(state,options)=>settle(state,{...options,fetchImpl:apify.fetchImpl})});
const CAPS=Number((profile.postsCapUsd+profile.repliesCapUsd).toFixed(6));
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

test('a rejected AI generation is logged with its reason and can be diagnosed by the operator',async()=>{
 const reply={candidates:[{finishReason:'STOP',content:{parts:[{text:'{"assessment":"x"}'}]}}],usageMetadata:{promptTokenCount:10,candidatesTokenCount:5}};
 const fetchImpl=async url=>({ok:true,json:async()=>url.endsWith('countTokens')?{totalTokens:400}:reply});
 const {core}=dataObject(ENV,{fetchImpl});
 const scan=core.store.create('sample_bad_ai');core.store.update(scan.id,{status:'completed',posts:bundle('sample_bad_ai').posts});
 core.aiStart(scan.id);
 const logs=[],original=console.log;console.log=line=>logs.push(line);
 try{await core.alarm();}finally{console.log=original;}
 assert.equal(core.aiInspect(scan.id).result.status,'invalid_output');
 assert.equal(JSON.parse(logs.find(l=>l.includes('ai invalid output'))).message,'ai invalid output');
 const app=createWorkerApp({...ENV,ADMIN_TOKEN:'admin-fixture',ASSETS:{fetch:async()=>new Response('')}},{storeStub:core,startScan:()=>{}});
 const diagnosis=await (await app(new Request(`https://whospost.example/api/admin/scans/${scan.id}/ai-diagnose`,{method:'POST',headers:{authorization:'Bearer admin-fixture'}}))).json();
 assert.equal(diagnosis.status,'invalid');assert.ok(diagnosis.reason.length>0);assert.equal(diagnosis.text,'{"assessment":"x"}');
 const closed=createWorkerApp({...ENV,ASSETS:{fetch:async()=>new Response('')}},{storeStub:core,startScan:()=>{}});
 assert.equal((await closed(new Request(`https://whospost.example/api/admin/scans/${scan.id}/ai-diagnose`,{method:'POST'}))).status,404);
 // Still broken under current rules: revalidation keeps it hidden and calls nothing.
 assert.equal((await (await app(new Request(`https://whospost.example/api/admin/scans/${scan.id}/ai-revalidate`,{method:'POST',headers:{authorization:'Bearer admin-fixture'}}))).json()).status,'invalid');
 assert.equal(core.aiInspect(scan.id).result.status,'invalid_output');
});
test('scan job runs through the data object, then starts shared AI once',async()=>{
 const {core}=dataObject();const calls=[];
 const stub=new Proxy(core,{get:(t,k)=>typeof t[k]==='function'?(...a)=>{calls.push(k);return Promise.resolve(t[k](...a));}:t[k]});
 const decision=core.requestScan('sample_job',profile,{configured:true,estimateUsd:.3});
 const job=new ScanJobCore({storage:fakeStorage()},{APIFY_TOKEN:'fixture-only'},{storeStub:stub,settleBills:async()=>false,fetchAccount:async(username,{budget,onState,token,waitSecs,maxPolls})=>{assert.equal(token,'fixture-only');assert.deepEqual([waitSecs,maxPolls],[60,4],'60 s long polls, four per alarm');await budget.reserve(`${decision.run}:posts`,.1);await onState({jobs:{posts:{runId:'fixture-run'}}});return bundle(username);}});
 await job.start(decision.run);await job.start(decision.run);
 assert.equal((await job.alarm()).status,'completed');
 const view=core.scanView(decision.run);
 assert.equal(view.status,'completed');assert.equal(core.getState(decision.run).jobs.posts.runId,'fixture-run');
 assert.ok(calls.includes('aiStart'));
 assert.deepEqual(await job.alarm(),{status:'settled'},'the next alarm only settles bills');
 assert.equal(await job.alarm(),undefined,'a finished job does not run again');
});

test('a scan is completed and AI started before any bill is read; later alarms settle the bills',async()=>{
 const {core}=dataObject();const storage=fakeStorage();let now=0;
 const apify=fakeApify('sample_settle');
 const stub=new Proxy(core,{get:(t,k)=>typeof t[k]==='function'?(...a)=>{if(k==='aiStart')apify.log.push('aiStart');return Promise.resolve(t[k](...a));}:t[k]});
 const id=core.requestScan('sample_settle',profile,{configured:true,estimateUsd:.3}).run;
 const job=apifyJob(storage,stub,apify,{now:()=>now});
 await job.start(id);
 assert.equal((await job.alarm()).status,'completed');
 assert.equal(core.get(id).status,'completed');assert.equal(core.get(id).posts.length,1);
 assert.equal(apify.log.at(-1),'aiStart');
 assert.deepEqual(apify.log.slice(0,-1).sort(),['rows:posts','rows:replies','start:posts','start:replies','wait:posts','wait:replies'],'rows go back and AI starts with no bill read');
 assert.equal(core.budgetSummary().committed,CAPS,'reservations count at their caps until settled');
 assert.equal(storage.getAlarm(),5000);
 now=5000;assert.deepEqual(await job.alarm(),{status:'settling'});
 assert.deepEqual(apify.log.slice(7).sort(),['read:posts','read:replies']);assert.equal(core.budgetSummary().committed,CAPS,'one read is not final');
 now=10000;assert.deepEqual(await job.alarm(),{status:'settled'});
 assert.deepEqual(core.budgetSummary(),{limit:2,committed:.08,spent:.08});
 assert.deepEqual(Object.values(core.getState(id).jobs).map(j=>j.usageFinal),[true,true]);
 assert.equal(await job.alarm(),undefined);assert.equal(apify.log.length,11,'a settled job reads nothing more');
});

test('a failed scan requested again while its bills settle runs first, without new paid runs or a second settlement',async()=>{
 const {core}=dataObject();const storage=fakeStorage();let now=0,fetches=0,requeue=false;
 const apify=fakeApify('sample_again');
 const id=core.requestScan('sample_again',profile,{configured:true,estimateUsd:.3}).run;
 const job=apifyJob(storage,core,apify,{now:()=>now,
  // The first run gets its rows, then fails later in the scan.
  fetch:async(username,options)=>{const bundle=await fetchAccount(username,options);if(++fetches===1)throw Object.assign(Error('later step failed'),{code:'PROVIDER_FAILED'});return bundle;},
  // The second pass is where the person asks again: start() runs while the pass is in flight.
  settle:async(state,options)=>{if(requeue){assert.equal(core.requestScan('sample_again',profile,{configured:true,estimateUsd:.3}).status,202);await job.start(id);}return settleBills(state,options);}});
 await job.start(id);
 assert.deepEqual(await job.alarm(),{status:'failed',code:'PROVIDER_FAILED',cause:'PROVIDER_FAILED'});
 now=5000;assert.deepEqual(await job.alarm(),{status:'settling'});
 now=10000;requeue=true;assert.deepEqual(await job.alarm(),{status:'requeued'},'the pass finishes but does not end the job');
 requeue=false;assert.equal(await storage.get('scanId'),id);assert.equal(storage.getAlarm(),10000,'the rerun is due at once');
 assert.deepEqual(core.budgetSummary(),{limit:2,committed:.08,spent:.08},'both bills were final in that pass');
 assert.equal((await job.alarm()).status,'completed');assert.equal(fetches,2);assert.equal(core.get(id).status,'completed');
 assert.equal(apify.log.filter(e=>e.startsWith('start:')).length,2,'the rerun resumed the saved runs');
 now=15000;assert.deepEqual(await job.alarm(),{status:'settled'});
 assert.deepEqual(core.budgetSummary(),{limit:2,committed:.08,spent:.08});assert.equal(await job.alarm(),undefined);
});

test('settlement errors never mark a finished scan failed, and its reservations keep counting at their caps',async()=>{
 const {core}=dataObject();const storage=fakeStorage();let now=0;
 const apify=fakeApify('sample_unsettled');
 const id=core.requestScan('sample_unsettled',profile,{configured:true,estimateUsd:.3}).run;
 const job=apifyJob(storage,core,apify,{now:()=>now,settle:async()=>{throw Error('ledger unavailable');}});
 await job.start(id);assert.equal((await job.alarm()).status,'completed');
 for(let i=0;i<5;i++){now=storage.getAlarm();assert.equal((await job.alarm()).status,'retrying');}
 now=storage.getAlarm();assert.deepEqual(await job.alarm(),{status:'unsettled'});
 assert.equal(core.get(id).status,'completed');assert.equal(core.budgetSummary().committed,CAPS);assert.equal(await storage.get('scanId'),undefined);
});

test('pending Apify work is resumed by a later alarm instead of failing',async()=>{
 const {core}=dataObject();const storage=fakeStorage();let now=1000;
 const decision=core.requestScan('sample_wait',profile,{configured:true,estimateUsd:.3});
 const job=new ScanJobCore({storage},{},{storeStub:core,now:()=>now,fetchAccount:async()=>{throw Object.assign(Error('pending'),{code:'APIFY_PENDING'});}});
 await job.start(decision.run);await job.alarm();
 assert.equal(core.get(decision.run).status,'running');assert.equal(storage.getAlarm(),4000);
 assert.equal(core.get(decision.run).progress,'Apify 任務仍在處理，稍後自動繼續','never reported as failed between alarms');
});

test('posts that finished in an alarm are served to viewers while replies are still pending',async()=>{
 const {core}=dataObject();const storage=fakeStorage();
 const decision=core.requestScan('sample_staged',profile,{configured:true,estimateUsd:.3});
 const posts=[{id:'p1',author:'sample_staged',kind:'post',text:'模擬測試貼文',postedAt:'2026-10-17T01:00:00Z',url:'https://www.threads.com/@sample_staged/post/p1'}];
 const job=new ScanJobCore({storage},{},{storeStub:core,now:()=>1000,fetchAccount:async(username,{onPartial})=>{onPartial({account:{name:null},posts});throw Object.assign(Error('pending'),{code:'APIFY_PENDING'});}});
 await job.start(decision.run);await job.alarm();
 const view=core.scanView(decision.run);
 assert.equal(view.status,'running');assert.deepEqual(view.partial.posts.map(p=>p.id),['p1']);assert.equal(view.partial.comments,undefined);
 assert.deepEqual(view.posts,[]);assert.equal(view.score.value,null);
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
 assert.equal(health.gaMeasurementId,null,'no Measurement ID unless the deployment sets one');
 const aiPost=await app(new Request(`https://whospost.example/api/scans/${started[0]}/ai`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}));
 assert.equal(aiPost.status,200);assert.equal((await aiPost.json()).status,'scan_not_ready');
 assert.equal(await (await app(new Request('https://whospost.example/'))).text(),'asset');
});
test('worker gate: a new-scan request carrying CF-Worker (another Worker proxy) is refused, own zone allowed',async()=>{
 const {core}=dataObject();const started=[];
 const env={...ENV,APIFY_TOKEN:'fixture-only',TURNSTILE_SECRET:'test-secret',TURNSTILE_HOSTNAMES:'whospost.example',IP_HASH_SALT:'salt',TURNSTILE_SITE_KEY:'site',ASSETS:{fetch:async()=>new Response('asset')}};
 const fetchImpl=async(url,{body})=>({ok:true,json:async()=>({success:body.get('response')==='good',action:'scan',hostname:'whospost.example'})});
 const post=(appInstance,headers)=>appInstance(new Request('https://whospost.example/api/scans',{method:'POST',headers:{'Content-Type':'application/json','cf-connecting-ip':'203.0.113.9',...headers},body:JSON.stringify({url:'https://www.threads.com/@sample_w',turnstileToken:'good'})}));
 const app=createWorkerApp(env,{storeStub:core,startScan:id=>started.push(id),fetchImpl});
 const blocked=await post(app,{'cf-worker':'evil-proxy.workers.dev'});
 assert.equal(blocked.status,403);assert.equal((await blocked.json()).code,'WORKER_PROXY_BLOCKED');assert.equal(started.length,0,'blocked before any scan dispatch');
 const allow=createWorkerApp({...env,WHOSPOST_ALLOWED_WORKER:'whospost.example'},{storeStub:core,startScan:id=>started.push(id),fetchImpl});
 const own=await post(allow,{'cf-worker':'whospost.example'});
 assert.equal(own.status,202);assert.equal(started.length,1,'our own zone passes the gate');
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
 assert.equal(core.getState(id).releases.posts,1,'the retry reserves under a new key');
 assert.equal(core.dailySummary().committed,0);
 assert.equal(core.requestScan('sample_stuck',profile,{configured:true,estimateUsd:.3}).status,202);
});
test('admin scan list needs the token and shows each account with its status and Apify spend',async()=>{
 let now=Date.parse('2026-10-01T00:00:00Z');
 const {core}=dataObject(ENV,{now:()=>now});
 const app=createWorkerApp({...ENV,ADMIN_TOKEN:'admin-fixture',ASSETS:{fetch:async()=>new Response('asset')}},{storeStub:core,startScan:()=>{}});
 const first=core.requestScan('sample_old',profile,{configured:true,estimateUsd:.3}).body.id;
 core.budgetReserve(`${first}:posts`,.1);core.budgetSettle(`${first}:posts`,.04,{final:true});
 core.budgetReserve(`${first}:posts:retry1`,.1);
 core.update(first,{status:'completed',...bundle('sample_old')});
 now+=60000;
 const second=core.requestScan('sample_new',profile,{configured:true,estimateUsd:.3}).body.id;
 core.update(second,{status:'failed',error:{code:'PROVIDER_FAILED',message:'x'}});
 const send=(token,method='POST')=>app(new Request('https://whospost.example/api/admin/scans',{method,headers:token?{authorization:`Bearer ${token}`}:{}}));
 assert.equal((await send('wrong')).status,401);
 assert.equal((await send('admin-fixture','GET')).status,404);
 const {scans}=await (await send('admin-fixture')).json();
 assert.deepEqual(scans.map(s=>[s.username,s.status,s.errorCode,s.apifyUsd]),[['sample_new','failed','PROVIDER_FAILED',0],['sample_old','completed',null,.14]]);
 assert.equal(scans[1].posts,1);assert.ok('signals' in scans[1]);assert.equal(scans[0].signals,null,'only completed scans are scored');
 const closed=createWorkerApp({...ENV,ASSETS:{fetch:async()=>new Response('')}},{storeStub:core,startScan:()=>{}});
 assert.equal((await closed(new Request('https://whospost.example/api/admin/scans',{method:'POST'}))).status,404);
});
test('admin request log lists every submitted search, including cache hits, behind the token',async()=>{
 let now=Date.parse('2026-10-01T00:00:00Z');
 const {core}=dataObject(ENV,{now:()=>now});
 const app=createWorkerApp({...ENV,ADMIN_TOKEN:'admin-fixture',ASSETS:{fetch:async()=>new Response('')}},{storeStub:core,startScan:()=>{}});
 const id=core.requestScan('sample_log',profile,{configured:true,estimateUsd:.3}).body.id;
 core.update(id,{status:'completed',...bundle('sample_log')});
 now+=60000;assert.equal(core.requestScan('sample_log',profile,{configured:true,estimateUsd:.3}).status,200,'cache hit');
 now+=60000;assert.equal(core.requestScan('sample_other',profile,{configured:true,estimateUsd:5}).status,503,'budget refusal is logged too');
 const send=token=>app(new Request('https://whospost.example/api/admin/requests',{method:'POST',headers:{authorization:`Bearer ${token}`}}));
 assert.equal((await send('wrong')).status,401);
 const log=await (await send('admin-fixture')).json();
 assert.deepEqual(log.requests.map(r=>[r.username,r.status,r.code]),[['sample_other',503,'BUDGET_EXCEEDED'],['sample_log',200,null],['sample_log',202,null]]);
 assert.equal(log.requests[1].scanId,id);
 assert.deepEqual(log.accounts.map(a=>[a.username,a.requests,a.cached,a.started]),[['sample_other',1,0,0],['sample_log',2,1,1]]);
 assert.equal(log.accounts[1].lastAt,'2026-10-01T00:01:00.000Z');
 const closed=createWorkerApp({...ENV,ASSETS:{fetch:async()=>new Response('')}},{storeStub:core,startScan:()=>{}});
 assert.equal((await closed(new Request('https://whospost.example/api/admin/requests',{method:'POST'}))).status,404);
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
 const storage=fakeStorage(),job=new ScanJobCore({storage},{},{storeStub:core,settleBills:async()=>false,fetchAccount:async u=>{fetches++;return bundle(u);}});
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
