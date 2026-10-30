// The extension's remote switches in /api/health (worker/extension-flags.mjs): on unless the deployment says "0".
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {StoreObjectCore} from '../../worker/store-object.mjs';
import {createWorkerApp} from '../../worker/app.mjs';
import {extensionFlags,REPLIES_DOC_ID} from '../../worker/extension-flags.mjs';
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
 const block=env=>extensionFlags(env).block;
 assert.equal(block({}),true);assert.equal(block({WHOSPOST_EXTENSION_BLOCK:'1'}),true);
 assert.equal(block({WHOSPOST_EXTENSION_BLOCK:'0'}),false);assert.equal(extensionFlags().block,true);
});

test('extensionFlags: reading replies in the user\'s browser is off unless "1", and its query is data the site can change',()=>{
 const query={docId:REPLIES_DOC_ID,first:25};
 assert.deepEqual(extensionFlags({}),{block:true,replies:false,repliesQuery:query});
 assert.equal(extensionFlags({WHOSPOST_EXTENSION_REPLIES:'true'}).replies,false,'only "1"');
 assert.equal(extensionFlags({WHOSPOST_EXTENSION_REPLIES:'1'}).replies,true);
 assert.deepEqual(extensionFlags({WHOSPOST_REPLIES_DOC_ID:'31234567890123456'}).repliesQuery,{docId:'31234567890123456',first:25},'Threads changed its query id: the site sends the new one');
 for(const bad of ['','abc','1;alert(1)','1'.repeat(26)])assert.equal(extensionFlags({WHOSPOST_REPLIES_DOC_ID:bad}).repliesQuery.docId,REPLIES_DOC_ID,bad);
});

test('/api/health carries extension.replies and its query, off by default',async()=>{
 const h=await health({});assert.equal(h.extension.replies,false);assert.deepEqual(h.extension.repliesQuery,{docId:REPLIES_DOC_ID,first:25});
 assert.equal((await health({WHOSPOST_EXTENSION_REPLIES:'1'})).extension.replies,true);
});

test('/api/health carries extension.block, so the site can hide the 封鎖助手 without a release',async()=>{
 assert.equal((await health({})).extension.block,true);
 assert.equal((await health({WHOSPOST_EXTENSION_BLOCK:'1'})).extension.block,true);
 assert.equal((await health({WHOSPOST_EXTENSION_BLOCK:'0'})).extension.block,false);
});
