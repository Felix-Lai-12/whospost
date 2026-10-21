import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {log,setLogSink,timer,pathPattern,requestLogger} from '../../worker/log.mjs';
import {createWorkerApp} from '../../worker/app.mjs';
import {StoreObjectCore} from '../../worker/store-object.mjs';
import {runScan} from '../../server/scan-runner.mjs';
import {createApifyUsage} from '../../worker/apify-usage.mjs';

// Collects every line the logger writes while `fn` runs, parsed back from JSON.
async function capture(fn){
 const lines=[];const restore=setLogSink((level,line)=>lines.push({level,line}));
 try{await fn();}finally{restore();}
 return lines.map(({level,line})=>{assert.equal(line.includes('\n'),false,'one line per event');return {sinkLevel:level,...JSON.parse(line)};});
}
const SENSITIVE_VALUES=['203.0.113.9','turnstile-token-value','Bearer admin-secret','sk-live-apikey'];
const assertClean=entries=>{const text=JSON.stringify(entries);for(const v of SENSITIVE_VALUES)assert.equal(text.includes(v),false,`log must not contain ${v}`);};

test('log(): single-line JSON with level and event; sensitive keys redacted, errors and long strings reduced',async()=>{
 const entries=await capture(()=>log('warn','gate.denied',{code:'RATE_LIMITED',status:429,ip:'203.0.113.9',turnstileToken:'turnstile-token-value',authorization:'Bearer admin-secret',apiKey:'sk-live-apikey',
  nested:{remoteIp:'203.0.113.9',ok:1},error:new Error('boom'),long:'x'.repeat(1000),skipped:undefined,fn(){},durationMs:12.7}));
 assert.equal(entries.length,1);const e=entries[0];
 assert.equal(e.sinkLevel,'warn');assert.equal(e.level,'warn');assert.equal(e.event,'gate.denied');assert.equal(e.code,'RATE_LIMITED');assert.equal(e.status,429);
 assert.deepEqual([e.ip,e.turnstileToken,e.authorization,e.apiKey,e.nested.remoteIp],Array(5).fill('[redacted]'));
 assert.equal(e.nested.ok,1);assert.equal(e.error,'boom');assert.equal(e.long.length,301);assert.equal('skipped' in e,false);assert.equal('fn' in e,false);assert.equal(e.durationMs,13);
 assertClean(entries);
});

test('log() never throws and maps unknown levels to info; timer() rounds to whole ms',async()=>{
 const entries=await capture(()=>log('loud','x',{self:(()=>{const o={};o.o=o;return o;})()}));
 assert.ok(entries.length<=1);
 let t=1000;const elapsed=timer(()=>t);t=1234.6;assert.equal(elapsed(),235);
 const level=(await capture(()=>log('verbose','y')))[0];assert.equal(level.level,'info');
});

test('pathPattern() collapses ids so routes group together',()=>{
 assert.equal(pathPattern('/api/scans/0f6d1c6e-9c3d-4e0b-8a3c-1234567890ab'),'/api/scans/:id');
 assert.equal(pathPattern('/api/scans/0f6d1c6e-9c3d-4e0b-8a3c-1234567890ab/ai'),'/api/scans/:id/ai');
 assert.equal(pathPattern('/api/og/0f6d1c6e-9c3d-4e0b-8a3c-1234567890ab.png'),'/api/og/:id.png');
 assert.equal(pathPattern('/api/admin/scans/0f6d1c6e-9c3d-4e0b-8a3c-1234567890ab/release-dispatch'),'/api/admin/scans/:id/release-dispatch');
 assert.equal(pathPattern('/api/scans'),'/api/scans');assert.equal(pathPattern('/api/health'),'/api/health');assert.equal(pathPattern('/assets/app.js'),'/assets/app.js');
});

test('requestLogger(): one request event per API call with method, path pattern, status and durationMs; assets only when they fail; throws become 500',async()=>{
 let t=0;const handler=async request=>{t+=42;const url=new URL(request.url);if(url.pathname==='/boom')throw new Error('kaboom secret-free');return new Response('',{status:url.pathname.includes('missing')?404:200});};
 const fetch=requestLogger(handler,{now:()=>t});
 const req=(path,init)=>fetch(new Request(`https://whospost.example${path}`,{headers:{'cf-ray':'8f1-TPE','cf-connecting-ip':'203.0.113.9',authorization:'Bearer admin-secret'},...init}));
 const entries=await capture(async()=>{
  await req('/api/scans/0f6d1c6e-9c3d-4e0b-8a3c-1234567890ab');await req('/',{});await req('/assets/app.js');await req('/assets/missing.js');
  const r=await req('/boom',{method:'POST'});assert.equal(r.status,500);assert.deepEqual(await r.json(),{error:'服務暫時無法回應'});
 });
 assert.deepEqual(entries.map(e=>[e.event,e.method,e.path,e.status,e.level]),[
  ['request','GET','/api/scans/:id',200,'info'],['request','GET','/',200,'info'],['request','GET','/assets/missing.js',404,'warn'],['request.unhandled','POST','/boom',500,'error']]);
 assert.equal(entries[0].durationMs,42);assert.equal(entries[0].ray,'8f1-TPE');assert.equal(entries[3].error,'kaboom secret-free');
 assertClean(entries);
});

// Minimal Durable Object storage, as in worker.test.mjs.
function fakeStorage(){
 const db=new DatabaseSync(':memory:'),kv=new Map();
 return {sql:{exec(text,...params){const rows=db.prepare(text).all(...params);return {toArray:()=>rows,one:()=>rows[0]};}},
  transactionSync(fn){db.exec('BEGIN');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}},
  setAlarm(){},async get(k){return kv.get(k);},async put(k,v){if(typeof k==='object')for(const [a,b] of Object.entries(k))kv.set(a,b);else kv.set(k,v);},async delete(k){for(const key of [k].flat())kv.delete(key);}};
}
const ENV={WHOSPOST_APIFY_LIMIT_USD:'2',WHOSPOST_DAILY_LIMIT_USD:'1',WHOSPOST_AI_LIMIT_USD:'1',WHOSPOST_AI_ENABLED:'0',APIFY_TOKEN:'fixture-only',TURNSTILE_SECRET:'test-secret',TURNSTILE_HOSTNAMES:'whospost.example',IP_HASH_SALT:'salt',WHOSPOST_IP_DAILY_SCANS:'1',TURNSTILE_SITE_KEY:'site',WHOSPOST_APIFY_USAGE_CHECK:'0',ASSETS:{fetch:async()=>new Response('')}};

test('gate refusals log gate.denied with code and status only: RATE_LIMITED, TURNSTILE_FAILED, DAILY_QUOTA, SCANS_PAUSED, no IP or token',async()=>{
 const core=new StoreObjectCore({storage:fakeStorage()},ENV,{prompt:'fixture'});let limited=false;
 const fetchImpl=async(url,{body})=>({ok:true,json:async()=>({success:body.get('response')==='good',action:'scan',hostname:'whospost.example'})});
 const env={...ENV,SCAN_RATE_LIMITER:{limit:async()=>({success:!limited})}};
 const app=createWorkerApp(env,{storeStub:core,startScan:()=>{},fetchImpl}),paused=createWorkerApp({...env,WHOSPOST_SCANS_ENABLED:'0'},{storeStub:core,startScan:()=>{},fetchImpl});
 const post=(a,body)=>a(new Request('https://whospost.example/api/scans',{method:'POST',headers:{'Content-Type':'application/json','cf-connecting-ip':'203.0.113.9'},body:JSON.stringify(body)}));
 const entries=await capture(async()=>{
  assert.equal((await post(app,{url:'https://www.threads.com/@sample_one',turnstileToken:'turnstile-token-value'})).status,403);
  assert.equal((await post(app,{url:'https://www.threads.com/@sample_one',turnstileToken:'good'})).status,202);
  assert.equal((await (await post(app,{url:'https://www.threads.com/@sample_two',turnstileToken:'good'})).json()).code,'DAILY_QUOTA');
  limited=true;assert.equal((await post(app,{url:'https://www.threads.com/@sample_two',turnstileToken:'good'})).status,429);limited=false;
  assert.equal((await (await post(paused,{url:'https://www.threads.com/@sample_three',turnstileToken:'good'})).json()).code,'SCANS_PAUSED');
 });
 const denied=entries.filter(e=>e.event==='gate.denied');
 assert.deepEqual(denied.map(e=>[e.code,e.status,e.level]),[['TURNSTILE_FAILED',403,'warn'],['DAILY_QUOTA',429,'warn'],['RATE_LIMITED',429,'warn'],['SCANS_PAUSED',503,'warn']]);
 assert.equal(denied[1].username,'sample_two');
 for(const e of denied){assert.equal('ip' in e,false);assert.equal('turnstileToken' in e,false);}
 assertClean(entries);
});

test('runScan logs scan.completed with scanId, username, counts and durationMs, and scan.failed with the error code',async()=>{
 const core=new StoreObjectCore({storage:fakeStorage()},ENV,{prompt:'fixture'}),store=core.store;
 const ok=store.create('sample_log'),bad=store.create('sample_fail');
 const bundle={account:{username:'sample_log',url:'https://www.threads.com/@sample_log',name:null},posts:[{id:'p1',author:'sample_log',kind:'post',text:'今天天氣很好',postedAt:'2026-10-01T00:00:00Z',url:'https://www.threads.com/@sample_log/post/p1'}],comments:[],comparison:[],collection:{status:'available',steps:[]}};
 const entries=await capture(async()=>{
  assert.equal((await runScan(ok.id,{store,fetchAccount:async()=>bundle})).status,'completed');
  assert.equal((await runScan(bad.id,{store,fetchAccount:async()=>{throw Object.assign(new Error('Apify 回傳 HTTP 402'),{code:'APIFY_HTTP',status:402});}})).status,'failed');
 });
 const done=entries.find(e=>e.event==='scan.completed'),failed=entries.find(e=>e.event==='scan.failed');
 assert.deepEqual([done.scanId,done.username,done.posts,done.comments,done.level],[ok.id,'sample_log',1,0,'info']);assert.equal(typeof done.durationMs,'number');
 assert.deepEqual([failed.scanId,failed.username,failed.code,failed.cause,failed.level],[bad.id,'sample_fail','PROVIDER_FAILED','APIFY_HTTP','warn']);
 assert.equal(JSON.stringify(entries).includes('今天天氣很好'),false,'post text never reaches the log');
});

test('Apify usage check failure goes through the structured log without the token',async()=>{
 const usage=createApifyUsage({token:'sk-live-apikey',fetchImpl:async()=>new Response('',{status:503})});
 const entries=await capture(()=>usage.snapshot());
 assert.equal(entries.length,1);assert.equal(entries[0].event,'apify.usage_check_failed');assert.equal(entries[0].level,'warn');assert.match(entries[0].error,/HTTP 503/);
 assertClean(entries);
});
