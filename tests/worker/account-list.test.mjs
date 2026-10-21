import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import {StoreObjectCore} from '../../worker/store-object.mjs';import {createWorkerApp} from '../../worker/app.mjs';
function setup(){const db=new DatabaseSync(':memory:'),storage={sql:{exec(sql,...args){const rows=db.prepare(sql).all(...args);return {toArray:()=>rows,one:()=>rows[0]};}},transactionSync:fn=>fn(),setAlarm(){}};return {db,core:new StoreObjectCore({storage},{},{prompt:'fixture'})};}
test('account list hashes identities, deduplicates newest completed scans and keeps unknown unknown; appeal is idempotent and does not change score',async()=>{
 const {core,db}=setup();const a=core.store.create('synthetic_list');core.store.update(a.id,{status:'completed'});
 const list=await core.listEntries();assert.equal(list.accounts.length,1);const entry=list.accounts[0];assert.match(entry.h,/^[a-f0-9]{64}$/);assert.equal(entry.score,null);assert.equal(entry.unknown,6);assert.equal(JSON.stringify(list).includes('synthetic_list'),false);
 const body={h:entry.h,installHash:'1'.repeat(64)};core.appeal(body);core.appeal(body);
 const next=await core.listEntries();assert.equal(next.accounts[0].appeals,1);assert.equal(next.accounts[0].score,null);assert.throws(()=>core.appeal({...body,h:'bad'}),/invalid appeal/);db.close();
});
test('public list is disabled by default, accepts only bucket hex and explicitly registered extension appeals',async()=>{
 const {core,db}=setup();const base={ASSETS:{fetch:()=>new Response('asset')},SCAN_RATE_LIMITER:{limit:async()=>({success:true})}};
 const app=env=>createWorkerApp({...base,...env},{storeStub:core,startScan:()=>{throw Error('no dispatch');}});
 assert.equal((await app({})(new Request('https://fixture/api/list/v1/bucket/abcd'))).status,404);
 const enabled=app({WHOSPOST_LIST_ENABLED:'1',WHOSPOST_EXTENSION_IDS:'known'});
 assert.deepEqual(await (await enabled(new Request('https://fixture/api/list/v1/bucket/abcd'))).json(),[]);
 const bad=await enabled(new Request('https://fixture/api/list/v1/appeal',{method:'POST',headers:{Origin:'https://evil.example'},body:'{}'}));assert.equal(bad.status,403);
 const good=await enabled(new Request('https://fixture/api/list/v1/appeal',{method:'POST',headers:{Origin:'chrome-extension://known'},body:JSON.stringify({h:'a'.repeat(64),installHash:'b'.repeat(64)})}));assert.equal(good.status,200);assert.equal(good.headers.get('Access-Control-Allow-Origin'),'chrome-extension://known');db.close();
});
