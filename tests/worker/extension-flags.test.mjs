// The extension's remote switches in /api/health (worker/extension-flags.mjs): on unless the deployment says "0".
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {StoreObjectCore} from '../../worker/store-object.mjs';
import {createWorkerApp} from '../../worker/app.mjs';
import {extensionFlags} from '../../worker/extension-flags.mjs';
const ENV={WHOSPOST_APIFY_LIMIT_USD:'2',WHOSPOST_DAILY_LIMIT_USD:'1',WHOSPOST_AI_LIMIT_USD:'1',GEMINI_API_KEY:'fixture-key'};
function fakeStorage(){
 const db=new DatabaseSync(':memory:');
 return {sql:{exec(text,...params){const rows=db.prepare(text).all(...params);return {toArray:()=>rows,one:()=>rows[0]};}},
  transactionSync(fn){db.exec('BEGIN');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}},setAlarm(){},async get(){},async put(){},async delete(){}};
}
const health=async env=>{
 const core=new StoreObjectCore({storage:fakeStorage()},ENV,{prompt:'fixture prompt'});
 const app=createWorkerApp({...ENV,ASSETS:{fetch:async()=>new Response('')},...env},{storeStub:core,startScan:()=>{}});
 const r=await app(new Request('https://whospost.example/api/health'));
 assert.equal(r.status,200);return r.json();
};

test('extensionFlags: block is on by default and for "1", off only for "0"',()=>{
 assert.deepEqual(extensionFlags({}),{block:true});
 assert.deepEqual(extensionFlags({WHOSPOST_EXTENSION_BLOCK:'1'}),{block:true});
 assert.deepEqual(extensionFlags({WHOSPOST_EXTENSION_BLOCK:'0'}),{block:false});
 assert.deepEqual(extensionFlags(),{block:true});
});

test('/api/health carries extension.block, so the site can hide the 封鎖助手 without a release',async()=>{
 assert.equal((await health({})).extension.block,true);
 assert.equal((await health({WHOSPOST_EXTENSION_BLOCK:'1'})).extension.block,true);
 assert.equal((await health({WHOSPOST_EXTENSION_BLOCK:'0'})).extension.block,false);
});
