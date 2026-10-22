import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {StoreObjectCore} from '../../worker/store-object.mjs';
import {createWorkerApp} from '../../worker/app.mjs';
import {shareCard} from '../../worker/share-meta.mjs';
import {cardVersion} from '../../worker/og-card.mjs';

// Cache API stand-in: caches.default keyed by request URL, with the stored Cache-Control recorded so a test can
// check the TTL the edge would apply. put() stores a clone's bytes, like the real one.
function fakeCaches(){
 const entries=new Map(),log=[];
 const key=r=>typeof r==='string'?r:r.url;
 return {log,entries,default:{
  async match(r){log.push(`match:${new URL(key(r)).pathname}`);const hit=entries.get(key(r));return hit?new Response(hit.body,{status:hit.status,headers:hit.headers}):undefined;},
  async put(r,res){log.push(`put:${new URL(key(r)).pathname}`);entries.set(key(r),{body:await res.arrayBuffer(),status:res.status,headers:[...res.headers]});},
  async delete(r){log.push(`delete:${new URL(key(r)).pathname}`);return entries.delete(key(r));}
 }};
}
const fakeStorage=()=>{const db=new DatabaseSync(':memory:');return {sql:{exec(text,...params){const rows=db.prepare(text).all(...params);return {toArray:()=>rows,one:()=>rows[0]};}},transactionSync(fn){db.exec('BEGIN');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}},setAlarm(){},async get(){},async put(){},async delete(){}};};
const ENV={WHOSPOST_APIFY_LIMIT_USD:'2',WHOSPOST_DAILY_LIMIT_USD:'1',WHOSPOST_AI_LIMIT_USD:'1',GEMINI_API_KEY:'fixture-key'};
const settled=()=>new Promise(r=>setImmediate(r));

test('a finished result is stored at the edge for 10 minutes and served as HIT; running scans and 404s are not stored',async()=>{
 const core=new StoreObjectCore({storage:fakeStorage()},ENV,{prompt:'fixture prompt'});let views=0;
 const stub=new Proxy(core,{get:(t,k)=>k==='scanView'?id=>{views++;return t.scanView(id);}:t[k]});
 const caches=fakeCaches(),pending=[];
 const app=createWorkerApp({...ENV,ASSETS:{fetch:async()=>new Response('')}},{storeStub:stub,startScan:()=>{},caches,waitUntil:p=>pending.push(p)});
 const done=core.store.create('sample_edge');core.store.update(done.id,{status:'completed'});
 const running=core.store.create('sample_live');
 const url=id=>`https://whospost.example/api/scans/${id}`;

 const miss=await app(new Request(url(done.id)));await Promise.all(pending);
 assert.equal(miss.status,200);assert.equal(miss.headers.get('X-Whospost-Cache'),'MISS');
 assert.equal(miss.headers.get('Cache-Control'),'public, max-age=600');
 assert.equal((await miss.json()).status,'completed','the MISS body is intact after the clone was stored');
 const hit=await app(new Request(url(done.id)));
 assert.equal(hit.headers.get('X-Whospost-Cache'),'HIT');
 assert.equal((await hit.json()).id,done.id);
 assert.equal(views,1,'the second request never reached the data object');

 const live=await app(new Request(url(running.id)));await Promise.all(pending);
 assert.equal(live.headers.get('X-Whospost-Cache'),'MISS');assert.equal(live.headers.get('Cache-Control'),'no-store');
 const missing=await app(new Request(url('0123abcd-0000-4000-8000-00000000dead')));await Promise.all(pending);
 assert.equal(missing.status,404);assert.equal(missing.headers.get('X-Whospost-Cache'),'MISS');
 assert.deepEqual(caches.log.filter(l=>l.startsWith('put:')),[`put:/api/scans/${done.id}`],'only the finished result was stored');
 assert.equal(views,3);
});

test('each card image URL (with its version) is stored at the edge for 7 days; a new version is a new key, the brand fallback is never stored',async()=>{
 const INDEX=readFileSync(new URL('../../frontend/index.html',import.meta.url),'utf8');
 const ID='0123abcd-0000-4000-8000-00000000beef';
 const scan={id:ID,status:'completed',score:{value:1,items:[{id:'s0',status:'yes'}]},account:{username:'sample_card',url:'https://www.threads.com/@sample_card',name:null},posts:[{id:'p1'}],comments:[],analysis:{}};
 let conclusion=null;
 const store={scanView:async id=>id===ID?scan:null,aiInspect:async()=>conclusion?{result:{status:'ready',result:{conclusion}}}:{result:{status:'pending'}}};
 const renders=[];
 const ogStub={png:async(id,card)=>{renders.push(card.lead);return new Uint8Array([0x89,0x50,0x4e,0x47]);}};
 const assets={fetch:async request=>new URL(request.url).pathname==='/og.png'?new Response('brand',{headers:{'content-type':'image/png'}}):new Response(INDEX,{headers:{'content-type':'text/html; charset=utf-8'}})};
 const caches=fakeCaches(),pending=[];
 const app=createWorkerApp({ASSETS:assets},{storeStub:store,ogStub,startScan:()=>{},caches,waitUntil:p=>pending.push(p)});
 const v1=cardVersion(shareCard(scan,null)),url=v=>`https://whospost.example/api/og/${ID}.png?v=${v}`;

 const first=await app(new Request(url(v1)));await Promise.all(pending);
 assert.equal(first.headers.get('X-Whospost-Cache'),'MISS');
 assert.equal(first.headers.get('cache-control'),'public, max-age=31536000, s-maxage=604800, immutable');
 const again=await app(new Request(url(v1)));
 assert.equal(again.headers.get('X-Whospost-Cache'),'HIT');
 assert.equal(again.headers.get('content-type'),'image/png');
 assert.deepEqual([...new Uint8Array(await again.arrayBuffer())],[0x89,0x50,0x4e,0x47]);
 assert.equal(renders.length,1,'the second request never reached the image object');

 conclusion='集中回覆同一帳號。';
 const v2=cardVersion(shareCard(scan,conclusion));assert.notEqual(v2,v1);
 const html=await (await app(new Request(`https://whospost.example/?scan=${ID}`))).text();
 assert.ok(html.includes(`/api/og/${ID}.png?v=${v2}`),'the share page now points crawlers at the new version');
 const fresh=await app(new Request(url(v2)));await Promise.all(pending);
 assert.equal(fresh.headers.get('X-Whospost-Cache'),'MISS');assert.deepEqual(renders,[null,conclusion].map(c=>c??renders[0]));
 const old=await app(new Request(url(v1)));
 assert.equal(old.headers.get('X-Whospost-Cache'),'HIT','the old version stays until its 7 days run out; nothing links to it any more');

 const stale=await app(new Request(url('00000000')));await Promise.all(pending);
 assert.equal(stale.headers.get('cache-control'),'public, max-age=300');
 const brand=await app(new Request('https://whospost.example/api/og/0123abcd-0000-4000-8000-000000000009.png'));await Promise.all(pending);
 assert.equal(await brand.text(),'brand');assert.equal(brand.headers.get('X-Whospost-Cache'),'MISS');
 assert.deepEqual(caches.log.filter(l=>l.startsWith('put:')).length,3,'two versions and the briefly kept old one; the brand card was not stored');
});

test('without a Cache API (Node, tests) every response is a MISS and nothing breaks',async()=>{
 const core=new StoreObjectCore({storage:fakeStorage()},ENV,{prompt:'fixture prompt'});
 const app=createWorkerApp({...ENV,ASSETS:{fetch:async()=>new Response('')}},{storeStub:core,startScan:()=>{},caches:undefined});
 const done=core.store.create('sample_nocache');core.store.update(done.id,{status:'completed'});
 for(let i=0;i<2;i++){const r=await app(new Request(`https://whospost.example/api/scans/${done.id}`));assert.equal(r.headers.get('X-Whospost-Cache'),'MISS');assert.equal(r.status,200);}
 await settled();
});

test('the health answer is stored at the edge for 15 seconds, so page loads in one data center reach the data object once',async()=>{
 const core=new StoreObjectCore({storage:fakeStorage()},ENV,{prompt:'fixture prompt'});let sums=0;
 const stub=new Proxy(core,{get:(t,k)=>k==='budgetSummary'?()=>{sums++;return t.budgetSummary();}:t[k]});
 const caches=fakeCaches(),pending=[];
 const app=createWorkerApp({...ENV,WHOSPOST_APIFY_USAGE_CHECK:'0',ASSETS:{fetch:async()=>new Response('')}},{storeStub:stub,startScan:()=>{},caches,waitUntil:p=>pending.push(p)});
 const miss=await app(new Request('https://whospost.example/api/health'));await Promise.all(pending);
 assert.equal(miss.headers.get('X-Whospost-Cache'),'MISS');assert.equal(miss.headers.get('Cache-Control'),'public, max-age=15');
 assert.equal((await miss.json()).ok,true,'the MISS body is intact after the clone was stored');
 const hit=await app(new Request('https://whospost.example/api/health'));
 assert.equal(hit.headers.get('X-Whospost-Cache'),'HIT');assert.equal((await hit.json()).ok,true);
 assert.equal(sums,1,'the second load never reached the data object');
});
