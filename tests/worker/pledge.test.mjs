import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {StoreObjectCore} from '../../worker/store-object.mjs';
import {createWorkerApp} from '../../worker/app.mjs';

function fakeStorage(){
 const db=new DatabaseSync(':memory:'),kv=new Map();
 return {sql:{exec(text,...params){const rows=db.prepare(text).all(...params);return {toArray:()=>rows,one:()=>rows[0]};}},transactionSync(fn){db.exec('BEGIN');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}},setAlarm(){},async get(k){return kv.get(k);},async put(k,v){kv.set(k,v);},async delete(k){kv.delete(k);}};
}
const ENV={WHOSPOST_APIFY_LIMIT_USD:'2',WHOSPOST_DAILY_LIMIT_USD:'1',WHOSPOST_AI_LIMIT_USD:'1',ASSETS:{fetch:async()=>new Response('')}};
const token='0123456789abcdef0123456789abcdef';
const post=(body,headers={})=>new Request('https://whospost.example/api/pledge',{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});
const counting=core=>{const calls={pledge:0,pledgeCount:0};return {stub:new Proxy(core,{get:(t,k)=>typeof t[k]==='function'?(...a)=>{if(k in calls)calls[k]++;return Promise.resolve(t[k](...a));}:t[k]}),calls};};

test('data object forwards pledge and pledgeCount; WHOSPOST_PLEDGE_GLOBAL_PER_MIN sets the site-wide ceiling',()=>{
 const core=new StoreObjectCore({storage:fakeStorage()},{...ENV,WHOSPOST_PLEDGE_GLOBAL_PER_MIN:'1'},{prompt:'p'});
 assert.deepEqual(core.pledge('a'.repeat(64)),{result:'counted',count:1});
 assert.deepEqual(core.pledge('b'.repeat(64)),{result:'rate_limited',count:1});
 assert.equal(core.pledgeCount().count,1);
 const open=new StoreObjectCore({storage:fakeStorage()},ENV,{prompt:'p'});
 assert.equal(open.store.pledgeRatePerMin,300,'default 300 per minute');
});

test('Worker: a pledge through a Worker proxy is 403, a rate-limited IP is 429 and the data object is never called',async()=>{
 const core=new StoreObjectCore({storage:fakeStorage()},ENV,{prompt:'p'}),{stub,calls}=counting(core);
 const keys=[];
 const app=createWorkerApp({...ENV,PLEDGE_RATE_LIMITER:{limit:async({key})=>{keys.push(key);return {success:key!=='9.9.9.9'};}}},{storeStub:stub,startScan:()=>{}});
 const proxied=await app(post({token},{'cf-worker':'evil.workers.dev'}));
 assert.equal(proxied.status,403);assert.equal((await proxied.json()).code,'WORKER_PROXY_BLOCKED');
 const limited=await app(post({token},{'cf-connecting-ip':'9.9.9.9'}));
 assert.equal(limited.status,429);assert.equal((await limited.json()).code,'RATE_LIMITED');
 assert.equal(calls.pledge,0);
 const ok=await app(post({token},{'cf-connecting-ip':'1.1.1.1'}));
 assert.deepEqual(await ok.json(),{result:'counted',count:1});
 assert.deepEqual(keys,['9.9.9.9','1.1.1.1']);
 // Bad input is refused before the rate limiter spends a hit.
 assert.equal((await app(post({token:'x'},{'cf-connecting-ip':'2.2.2.2'}))).status,400);
 assert.deepEqual(keys,['9.9.9.9','1.1.1.1']);
 // GET is not gated and is cached per isolate for 60 s.
 const first=await app(new Request('https://whospost.example/api/pledge'));
 assert.equal(first.headers.get('cache-control'),'public, max-age=60');assert.equal((await first.json()).count,1);
 await app(post({token:'c'.repeat(32)},{'cf-connecting-ip':'1.1.1.1'}));
 assert.equal((await (await app(new Request('https://whospost.example/api/pledge'))).json()).count,1,'still the cached count');
 assert.equal(calls.pledgeCount,1);
});

test('wrangler.jsonc declares the pledge rate limiter and the site-wide variable',()=>{
 const cfg=readFileSync(new URL('../../wrangler.jsonc',import.meta.url),'utf8');
 assert.match(cfg,/"name": "PLEDGE_RATE_LIMITER", "namespace_id": "2702", "simple": \{ "limit": 3, "period": 60 \}/);
 assert.match(cfg,/"WHOSPOST_PLEDGE_GLOBAL_PER_MIN": "300"/);
});
