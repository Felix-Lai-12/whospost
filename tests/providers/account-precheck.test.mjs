import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {checkThreadsProfile,CONTROL_ACCOUNT,PRECHECK_TTL_MS} from '../../server/providers/threads-profile.mjs';
import {Store} from '../../server/store.mjs';
import {runScan} from '../../server/scan-runner.mjs';
import {StoreObjectCore} from '../../worker/store-object.mjs';
import {ScanJobCore} from '../../worker/scan-object.mjs';
import {collectionProfile} from '../../server/collection-profile.mjs';

// Responses shaped like the ones measured from Cloudflare egress; only fixture names, never real accounts.
const page=(username,body='')=>new Response(`<!DOCTYPE html><html><head><meta property="og:type" content="profile" /><meta property="og:title" content="Fixture &#x2022; (&#064;${username}) &#x2022; Threads, Say more" /><meta property="og:description" content="12 Followers &#x2022; 3 Threads" />${body}</head><body>${'x'.repeat(2000)}</body></html>`,{status:200,headers:{'content-type':'text/html'}});
const toLogin=username=>new Response(null,{status:302,headers:{location:`https://www.threads.com/login/?next=https%3A%2F%2Fwww.threads.com%2F%40${username}%2F`}});
const shell=()=>new Response('<!DOCTYPE html><html><head><title>Threads</title></head><body></body></html>',{status:200});
// answers: username -> Response factory. Records every profile request.
function threads(answers){
 const calls=[];
 return {calls,fetchImpl:async(url,init={})=>{
  const name=decodeURIComponent(new URL(url).pathname.slice(2));calls.push({name,agent:init.headers?.['User-Agent'],redirect:init.redirect});
  const answer=answers[name];if(!answer)throw new Error(`unexpected profile ${name}`);return answer(name);
 }};
}

test('an existing account is available after one request, sent with a named agent and no redirect follow',async()=>{
 const t=threads({fixture_public:page});
 assert.equal((await checkThreadsProfile('fixture_public',{fetchImpl:t.fetchImpl})).status,'available');
 assert.equal(t.calls.length,1,'no control request when the target answers');
 assert.equal(t.calls[0].redirect,'manual');assert.match(t.calls[0].agent,/Whospost/);
});

test('a page whose og:title names a different account is not taken as this one',async()=>{
 const t=threads({fixture_other:()=>page('someone_else')});
 assert.equal((await checkThreadsProfile('fixture_other',{fetchImpl:t.fetchImpl})).status,'unknown');
});

test('a private profile marker makes the account private',async()=>{
 const t=threads({fixture_private:name=>page(name,'<meta name="description" content="This profile is private." />')});
 assert.equal((await checkThreadsProfile('fixture_private',{fetchImpl:t.fetchImpl})).status,'private');
});

test('a login redirect is not found only when the control account still answers',async()=>{
 const t=threads({zz_fake_missing:toLogin,[CONTROL_ACCOUNT]:page});
 assert.equal((await checkThreadsProfile('zz_fake_missing',{fetchImpl:t.fetchImpl})).status,'not_found');
 assert.deepEqual(t.calls.map(c=>c.name),['zz_fake_missing',CONTROL_ACCOUNT]);
});

test('check unavailable: a login wall, an error, a timeout, a JS shell or a throttle all answer unknown',async()=>{
 const cases={
  wall:{zz_fake_missing:toLogin,[CONTROL_ACCOUNT]:toLogin},
  controlDown:{zz_fake_missing:toLogin,[CONTROL_ACCOUNT]:()=>new Response('',{status:500})},
  network:{zz_fake_missing:()=>{throw new TypeError('network');}},
  throttled:{zz_fake_missing:()=>new Response('',{status:429})},
  shell:{zz_fake_missing:shell},
  unsupported:{zz_fake_missing:()=>new Response(null,{status:302,headers:{location:'https://www.facebook.com/unsupportedbrowser'}})},
 };
 for(const [name,answers] of Object.entries(cases))assert.equal((await checkThreadsProfile('zz_fake_missing',{fetchImpl:threads(answers).fetchImpl})).status,'unknown',name);
 const hang=(url,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason)));
 assert.equal((await checkThreadsProfile('zz_fake_missing',{fetchImpl:hang,timeoutMs:20})).status,'unknown','timeout');
 // The control account itself redirected cannot be confirmed against itself.
 assert.equal((await checkThreadsProfile(CONTROL_ACCOUNT,{fetchImpl:threads({[CONTROL_ACCOUNT]:toLogin}).fetchImpl})).status,'unknown');
});

test('only the head of the ~570 KB profile page is read',async()=>{
 let pulled=0;const encoder=new TextEncoder();
 const head=encoder.encode('<html><head><meta property="og:title" content="Fixture (&#064;fixture_public) &#x2022; Threads" /></head><body>');
 const body=new ReadableStream({pull(c){pulled++;c.enqueue(pulled===1?head:encoder.encode('x'.repeat(16384)));if(pulled>40)c.close();}});
 const result=await checkThreadsProfile('fixture_public',{fetchImpl:async()=>new Response(body,{status:200})});
 assert.equal(result.status,'available');assert.ok(pulled<=3,`read ${pulled} chunks`);
});

// The scan runner: a negative answer fails the scan before any paid job, reserves nothing and is cached briefly.
const bundle=username=>({account:{username,url:`https://www.threads.com/@${username}`,name:null},posts:[{id:'p1',author:username,kind:'post',text:'模擬測試貼文，只用來驗證預檢。',postedAt:'2026-10-17T00:00:00Z',url:`https://www.threads.com/@${username}/post/p1`}],comments:[],comparison:[],comparedTargetIds:[],commentsAvailable:false,limitations:[]});
function scanStore(){let now=Date.parse('2026-10-19T00:00:00Z');const store=new Store(':memory:',{now:()=>now});return {store,advance:ms=>{now+=ms;}};}
function counting(verdict){const calls=[];return {calls,precheck:async username=>{calls.push(username);if(verdict instanceof Error)throw verdict;return {status:verdict,ms:1};}};}
function paid(){const calls=[];return {calls,fetchAccount:async(username,{budget})=>{calls.push(username);await budget.reserve(`fixture:${username}`,.02);return bundle(username);}};}

for(const [verdict,code,message] of [['private','ACCOUNT_PRIVATE','這是私人帳號，無法分析。'],['not_found','ACCOUNT_NOT_FOUND','找不到這個帳號，請確認帳號名稱。']])
test(`${verdict}: the scan fails with a clear message, starts no paid job and reserves nothing`,async()=>{
 const {store}=scanStore(),{id}=store.create('zz_fake_target'),check=counting(verdict),apify=paid();
 assert.deepEqual(await runScan(id,{store,fetchAccount:apify.fetchAccount,precheck:check.precheck}),{status:'failed',code,cause:code});
 const scan=store.get(id);
 assert.equal(scan.status,'failed');assert.deepEqual(scan.error,{code,message});assert.equal(scan.progress,message);
 assert.equal(apify.calls.length,0,'no paid job');
 assert.deepEqual(store.budgetSummary(),{limit:1,committed:0,spent:0});
 assert.equal(store.db.prepare('SELECT COUNT(*) n FROM budget').get().n,0,'no reservation row');
});

test('a negative answer is cached for 10 minutes, then checked again',async()=>{
 const {store,advance}=scanStore(),check=counting('not_found'),apify=paid();
 for(let i=0;i<2;i++){const {id}=store.create('zz_fake_target');await runScan(id,{store,fetchAccount:apify.fetchAccount,precheck:check.precheck});assert.equal(store.get(id).error.code,'ACCOUNT_NOT_FOUND');}
 assert.equal(check.calls.length,1,'the second scan reads the cache');
 advance(PRECHECK_TTL_MS+1);
 const {id}=store.create('zz_fake_target');await runScan(id,{store,fetchAccount:apify.fetchAccount,precheck:check.precheck});
 assert.equal(check.calls.length,2,'expired after 10 minutes');assert.equal(apify.calls.length,0);
});

for(const [label,verdict] of [['public','available'],['check unavailable','unknown'],['check threw',new Error('boom')]])
test(`${label}: the scan proceeds to the paid jobs and nothing is cached`,async()=>{
 const {store}=scanStore(),check=counting(verdict),apify=paid();
 for(let i=0;i<2;i++){const {id}=store.create('zz_fake_target');assert.equal((await runScan(id,{store,fetchAccount:apify.fetchAccount,precheck:check.precheck})).status,'completed');}
 assert.equal(apify.calls.length,2);assert.equal(check.calls.length,2,'only clear negatives are cached');
 assert.equal(store.cacheGet('precheck:zz_fake_target'),null);
});

test('a resumed scan with saved paid jobs is not checked again',async()=>{
 const {store}=scanStore(),{id}=store.create('zz_fake_target'),check=counting('not_found'),apify=paid();
 store.setState(id,{jobs:{posts:{runId:'saved',dispatched:true}}});
 assert.equal((await runScan(id,{store,fetchAccount:apify.fetchAccount,precheck:check.precheck})).status,'completed');
 assert.equal(check.calls.length,0);assert.equal(apify.calls.length,1);
});

test('no precheck configured keeps the old behaviour',async()=>{
 const {store}=scanStore(),{id}=store.create('zz_fake_target'),apify=paid();
 assert.equal((await runScan(id,{store,fetchAccount:apify.fetchAccount})).status,'completed');
});

// The Worker path: the scan job's precheck runs over the data object's RPC store, cache included.
function fakeStorage(){
 const db=new DatabaseSync(':memory:'),kv=new Map();let alarm=null;
 return {
  sql:{exec(text,...params){const rows=db.prepare(text).all(...params);return {toArray:()=>rows,one:()=>rows[0]};}},
  transactionSync(fn){db.exec('BEGIN');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}},
  setAlarm(t){alarm=t;},getAlarm:()=>alarm,
  async get(k){return kv.get(k);},async put(k,v){if(typeof k==='object')for(const [a,b] of Object.entries(k))kv.set(a,b);else kv.set(k,v);},async delete(k){for(const key of [k].flat())kv.delete(key);}
 };
}
test('worker: a private account fails in the scan job before any reservation, and the answer is cached in the data object',async()=>{
 const core=new StoreObjectCore({storage:fakeStorage()},{WHOSPOST_APIFY_LIMIT_USD:'2',WHOSPOST_DAILY_LIMIT_USD:'1'},{prompt:'fixture prompt'});
 const profile=collectionProfile('standard'),check=counting('private'),apify=paid();
 const decision=core.requestScan('zz_fake_target',profile,{configured:true,estimateUsd:.12});
 const storage=fakeStorage(),job=new ScanJobCore({storage},{},{storeStub:core,now:()=>0,settleBills:async()=>false,fetchAccount:apify.fetchAccount,precheck:check.precheck});
 await job.start(decision.run);
 assert.deepEqual(await job.alarm(),{status:'failed',code:'ACCOUNT_PRIVATE',cause:'ACCOUNT_PRIVATE'});
 assert.equal(core.get(decision.run).error.message,'這是私人帳號，無法分析。');
 assert.equal(apify.calls.length,0);assert.equal(core.budgetSummary().committed,0);
 assert.equal(core.cacheGet('precheck:zz_fake_target').status,'private');
});
