import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {StoreObjectCore} from '../../worker/store-object.mjs';
import {ScanJobCore} from '../../worker/scan-object.mjs';
import {createWorkerApp} from '../../worker/app.mjs';
import {quickResult} from '../../server/scan-runner.mjs';
import {collectionProfile} from '../../server/collection-profile.mjs';
// 即時查 from the browser extension (EXTENSION-SPEC §4.3): the whitelisted channel into POST /api/scans without Turnstile,
// CORS on the status route, and the two-stage result (quick 快篩 while the full replies job runs, then the full result).
function fakeStorage(){
 const db=new DatabaseSync(':memory:'),kv=new Map();let alarm=null;
 return {sql:{exec(text,...params){const rows=db.prepare(text).all(...params);return {toArray:()=>rows,one:()=>rows[0]};}},
  transactionSync(fn){db.exec('BEGIN');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}},
  setAlarm(t){alarm=t;},getAlarm:()=>alarm,
  async get(k){return kv.get(k);},async put(k,v){if(typeof k==='object')for(const [a,b] of Object.entries(k))kv.set(a,b);else kv.set(k,v);},async delete(k){for(const key of [k].flat())kv.delete(key);}};
}
const ENV={WHOSPOST_APIFY_LIMIT_USD:'2',WHOSPOST_DAILY_LIMIT_USD:'1',WHOSPOST_AI_LIMIT_USD:'1',WHOSPOST_AI_ENABLED:'0',GEMINI_API_KEY:'fixture-key'};
const dataObject=()=>{const ctx={storage:fakeStorage()};return {ctx,core:new StoreObjectCore(ctx,ENV,{prompt:'fixture prompt'})};};
const profile=collectionProfile('standard');
const ID='a'.repeat(32),OTHER='b'.repeat(32),EXT=`chrome-extension://${ID}`;
const post=(u,i)=>({id:`p${i}`,author:u,kind:'post',text:`這是一篇有足夠長度的公開技術教學分享內容第 ${i} 篇`,postedAt:`2026-10-1${i%9}T00:00:00Z`,url:`https://www.threads.com/@${u}/post/p${i}`,source:'cloudflare-browser',isQuote:false,isRepost:false});
const reply=(u,i,text='支持到底 這個政策一定要過 大家一起來')=>({id:`r${i}`,author:u,kind:'authored_reply',text,postedAt:`2026-10-17T00:0${i%9}:00Z`,url:`https://www.threads.com/@${u}/post/r${i}`,parentUrl:`https://www.threads.com/@someone/post/parent${i%3}`,parentAuthor:'someone',source:'cloudflare-browser',isQuote:false,isRepost:false,isReply:true});
const scanOf=u=>({id:'scan-1',status:'running',account:{username:u,url:`https://www.threads.com/@${u}`,name:null},collectionRequest:profile});

test('quickResult scores the browser sample like a finished scan, marked partial, counts only, no rows',()=>{
 const sample={name:'測試',posts:Array.from({length:10},(_,i)=>post('sample_q',i)),comments:Array.from({length:8},(_,i)=>reply('sample_q',i))};
 const quick=quickResult(scanOf('sample_q'),sample,new Date('2026-10-23T04:00:00Z'));
 assert.equal(quick.partial,true);assert.equal(quick.source,'browser');assert.equal(quick.at,'2026-10-23T04:00:00.000Z');
 assert.equal(quick.posts,10);assert.equal(quick.comments,8);
 assert.equal(quick.score.version,'signals-v2');assert.ok(quick.score.hits.includes('content-comments'),'eight identical replies hit the repetition rule');
 assert.equal(quick.score.value,quick.score.hits.length);assert.equal(quick.score.assessed+quick.score.unknown,6);
 assert.equal('items' in quick.score,false);assert.equal(JSON.stringify(quick).includes('支持到底'),false,'no reply text in the quick view');
 const thin=quickResult(scanOf('sample_q'),{posts:[post('sample_q',1)],comments:[]});
 assert.equal(thin.score.value,null,'too little to assess anything is null, never 0');assert.equal(thin.score.unknown,6);
 assert.deepEqual(quickResult(scanOf('sample_q'),null).score.hits,[]);
});

function world({ids='',limited=false,extLimiter=true,extLimit=5}={}){
 const {core}=dataObject();const started=[];const extKeys=[];
 // The extension channel's own limiter counts calls like Cloudflare's does: the first `extLimit` in a window pass.
 const EXT_SCAN_RATE_LIMITER={limit:async({key})=>{extKeys.push(key);return {success:extKeys.length<=extLimit};}};
 const env={...ENV,APIFY_TOKEN:'fixture-only',TURNSTILE_SECRET:'test-secret',TURNSTILE_HOSTNAMES:'whospost.example',IP_HASH_SALT:'salt',TURNSTILE_SITE_KEY:'site',WHOSPOST_EXTENSION_IDS:ids,SCAN_RATE_LIMITER:{limit:async()=>({success:!limited})},...(extLimiter?{EXT_SCAN_RATE_LIMITER}:{}),ASSETS:{fetch:async()=>new Response('asset')}};
 let verified=0;const fetchImpl=async(url,{body})=>{if(url.includes('apify.com'))return Response.json({data:{current:{monthlyUsageUsd:1},limits:{maxMonthlyUsageUsd:5}}});verified++;return {ok:true,json:async()=>({success:body.get('response')==='good',action:'scan',hostname:'whospost.example'})};};
 const app=createWorkerApp(env,{storeStub:core,startScan:id=>{started.push(id);},fetchImpl});
 const post=(body,headers={})=>app(new Request('https://whospost.example/api/scans',{method:'POST',headers:{'Content-Type':'application/json','cf-connecting-ip':'203.0.113.9',...headers},body:JSON.stringify(body)}));
 return {core,app,post,started,verified:()=>verified,extKeys};
}

test('the extension channel has its own cross-IP ceiling: five starts a minute under one fixed key, the sixth is 429 whatever the IP; the site path never touches it',async()=>{
 const w=world({ids:ID});
 for(let i=1;i<=5;i++){
  const r=await w.post({url:`https://www.threads.com/@sample_g${i}`},{Origin:EXT,'cf-connecting-ip':`198.51.100.${i}`});
  assert.equal(r.status,202,`start ${i} passes`);
 }
 const sixth=await w.post({url:'https://www.threads.com/@sample_g6'},{Origin:EXT,'cf-connecting-ip':'198.51.100.6'});
 assert.equal(sixth.status,429);assert.deepEqual(await sixth.json(),{code:'EXTENSION_RATE_LIMITED',error:'即時查太頻繁，請稍後再試。'});
 assert.equal(sixth.headers.get('access-control-allow-origin'),EXT,'the refusal is readable by the extension');
 assert.equal(w.started.length,5,'the sixth never started a scan');
 assert.deepEqual([...new Set(w.extKeys)],['extension-global'],'one key for every IP');
 // Website scans go through Turnstile, not this limiter.
 const site=await w.post({url:'https://www.threads.com/@sample_g7',turnstileToken:'good'});
 assert.equal(site.status,202);assert.equal(w.extKeys.length,6,'the site start did not consume the extension ceiling');
});

test('without the EXT_SCAN_RATE_LIMITER binding the extension channel is closed (503), not open; the site path is unaffected',async()=>{
 const w=world({ids:ID,extLimiter:false});
 const r=await w.post({url:'https://www.threads.com/@sample_nb'},{Origin:EXT});
 assert.equal(r.status,503);assert.equal((await r.json()).code,'EXTENSION_NOT_CONFIGURED');assert.equal(w.started.length,0);
 const site=await w.post({url:'https://www.threads.com/@sample_nb',turnstileToken:'good'});
 assert.equal(site.status,202);
});

test('a whitelisted extension starts a scan without a Turnstile token and gets the CORS header; the per-IP limiter still applies',async()=>{
 const w=world({ids:`${OTHER}, ${ID}`});
 const ok=await w.post({url:'https://www.threads.com/@sample_ext'},{Origin:EXT});
 assert.equal(ok.status,202);assert.equal(ok.headers.get('access-control-allow-origin'),EXT);assert.equal(ok.headers.get('vary'),'Origin');
 assert.equal(w.started.length,1);assert.equal(w.verified(),0,'siteverify never called');
 const again=await w.post({url:'https://www.threads.com/@sample_ext'},{Origin:EXT});
 assert.equal(again.status,202);assert.equal((await again.json()).id,(await ok.json()).id,'the same running scan is answered, not started twice');
 const limited=world({ids:ID,limited:true});
 const r=await limited.post({url:'https://www.threads.com/@sample_ext'},{Origin:EXT});
 assert.equal(r.status,429);assert.equal((await r.json()).code,'RATE_LIMITED');
 // The site itself still needs Turnstile.
 const site=await w.post({url:'https://www.threads.com/@sample_site'});
 assert.equal(site.status,403);assert.equal((await site.json()).code,'TURNSTILE_FAILED');
 const siteOk=await w.post({url:'https://www.threads.com/@sample_site',turnstileToken:'good'});
 assert.equal(siteOk.status,202);assert.equal(siteOk.headers.get('access-control-allow-origin'),null);
});

test('an extension not on the whitelist, or any extension while the whitelist is empty, is a foreign origin: 403 and no CORS',async()=>{
 const other=await world({ids:ID}).post({url:'https://www.threads.com/@sample_x'},{Origin:`chrome-extension://${OTHER}`});
 assert.equal(other.status,403);assert.equal(other.headers.get('access-control-allow-origin'),null);
 const empty=await world({ids:''}).post({url:'https://www.threads.com/@sample_x'},{Origin:EXT});
 assert.equal(empty.status,403,'an empty whitelist keeps the channel closed');
 const malformed=await world({ids:ID}).post({url:'https://www.threads.com/@sample_x'},{Origin:'chrome-extension://not-an-id'});
 assert.equal(malformed.status,403);
 const withToken=await world({ids:''}).post({url:'https://www.threads.com/@sample_x',turnstileToken:'good'},{Origin:EXT});
 assert.equal(withToken.status,403,'a token does not open it either: the origin is foreign');
});

test('preflight: OPTIONS /api/scans answers 204 with the allowed method and header for a whitelisted extension, 403 otherwise',async()=>{
 const w=world({ids:ID});
 const ok=await w.app(new Request('https://whospost.example/api/scans',{method:'OPTIONS',headers:{Origin:EXT,'Access-Control-Request-Method':'POST'}}));
 assert.equal(ok.status,204);assert.equal(ok.headers.get('access-control-allow-origin'),EXT);assert.equal(ok.headers.get('access-control-allow-methods'),'POST, OPTIONS');assert.match(ok.headers.get('access-control-allow-headers'),/Content-Type/);
 assert.equal((await w.app(new Request('https://whospost.example/api/scans',{method:'OPTIONS',headers:{Origin:`chrome-extension://${OTHER}`}}))).status,403);
 assert.equal((await world({ids:''}).app(new Request('https://whospost.example/api/scans',{method:'OPTIONS',headers:{Origin:EXT}}))).status,403);
});

test('the status route carries CORS for a whitelisted extension, on a fresh answer and on an edge hit, never for others',async()=>{
 const w=world({ids:ID});
 const scan=w.core.store.create('sample_poll');
 const stored=new Map();const caches={default:{match:async r=>{const hit=stored.get(r.url);return hit?hit.clone():undefined;},put:async(r,res)=>{stored.set(r.url,res);}}};
 const app=createWorkerApp({...ENV,WHOSPOST_EXTENSION_IDS:ID,ASSETS:{fetch:async()=>new Response('')}},{storeStub:w.core,startScan:()=>{},caches,waitUntil:p=>p});
 const get=headers=>app(new Request(`https://whospost.example/api/scans/${scan.id}`,{headers}));
 const running=await get({Origin:EXT});
 assert.equal(running.status,200);assert.equal(running.headers.get('access-control-allow-origin'),EXT);assert.equal((await running.json()).status,'queued');
 assert.equal((await get({})).headers.get('access-control-allow-origin'),null);
 assert.equal((await get({Origin:`chrome-extension://${OTHER}`})).headers.get('access-control-allow-origin'),null);
 w.core.store.update(scan.id,{status:'completed'});
 const first=await get({Origin:EXT});await Promise.resolve();
 assert.equal(first.headers.get('x-whospost-cache'),'MISS');assert.equal(first.headers.get('access-control-allow-origin'),EXT);
 const hit=await get({Origin:EXT});
 assert.equal(hit.headers.get('x-whospost-cache'),'HIT');assert.equal(hit.headers.get('access-control-allow-origin'),EXT,'added per request after the cache');
 const anon=await get({});
 assert.equal(anon.headers.get('x-whospost-cache'),'HIT');assert.equal(anon.headers.get('access-control-allow-origin'),null,'the stored copy carries none');
});

test('two-stage result: the quick 快篩 is written while the replies job is pending and shown by the status view; the full result replaces it',async()=>{
 const {core}=dataObject();const storage=fakeStorage();let round=0;
 const decision=core.requestScan('sample_two',profile,{configured:true,estimateUsd:.3});
 const posts=Array.from({length:10},(_,i)=>post('sample_two',i)),browserReplies=Array.from({length:8},(_,i)=>reply('sample_two',i));
 const apifyReplies=Array.from({length:20},(_,i)=>reply('sample_two',100+i,`這是第 ${i} 則各自不同的留言內容，長度足夠也不重複`));
 const job=new ScanJobCore({storage},{},{storeStub:core,now:()=>1000,fetchAccount:async(username,{onPartial,onQuick})=>{
  round++;
  onPartial({account:{name:'測試'},posts});onQuick({name:'測試',posts,comments:browserReplies});
  if(round===1)throw Object.assign(Error('pending'),{code:'APIFY_PENDING'});
  return {account:{username,url:`https://www.threads.com/@${username}`,name:'測試'},posts,comments:apifyReplies,comparison:[],comparedTargetIds:[],commentsAvailable:true,limitations:[],collection:{status:'available',provider:'hybrid',steps:[{key:'browser',status:'succeeded'},{key:'replies',status:'succeeded'}]}};
 }});
 await job.start(decision.run);await job.alarm();
 const running=core.scanView(decision.run);
 assert.equal(running.status,'running');assert.equal(running.quick.partial,true);assert.equal(running.quick.comments,8);assert.equal(running.quick.posts,10);
 assert.ok(running.quick.score.hits.includes('content-comments'),'the quick view already scores the repeated replies');
 assert.equal(running.score.value,null,'the real score stays unknown until the scan ends');assert.deepEqual(running.partial.posts.map(p=>p.id).length,10);
 await job.alarm();
 const done=core.scanView(decision.run);
 assert.equal(done.status,'completed');assert.equal(done.quick,null,'the full result replaces the quick one');assert.equal(done.partial,null);
 assert.equal(done.comments.length,20);assert.ok(!done.score.items.find(i=>i.id==='content-comments'&&i.status==='yes'),'twenty different replies: the full sample overrides the quick hit');
});

test('a scan that fails after a quick result clears it, so a viewer never mistakes the quick score for an answer',async()=>{
 const {core}=dataObject();const storage=fakeStorage();let round=0;
 const decision=core.requestScan('sample_fail',profile,{configured:true,estimateUsd:.3});
 const job=new ScanJobCore({storage},{},{storeStub:core,now:()=>1000,fetchAccount:async(username,{onQuick})=>{round++;onQuick({posts:Array.from({length:10},(_,i)=>post(username,i)),comments:[]});if(round===1)throw Object.assign(Error('pending'),{code:'APIFY_PENDING'});throw Object.assign(Error('boom'),{code:'APIFY_NETWORK'});}});
 await job.start(decision.run);await job.alarm();
 assert.equal(core.scanView(decision.run).quick.partial,true);
 await job.alarm();
 const failed=core.scanView(decision.run);
 assert.equal(failed.status,'failed');assert.equal(failed.quick,null);
});
