import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {shareCard} from '../../worker/share-meta.mjs';
import {cardVersion,cardElement} from '../../worker/og-card.mjs';
import {OgImageCore} from '../../worker/og-object.mjs';
import {createWorkerApp} from '../../worker/app.mjs';

const INDEX=readFileSync(new URL('../../frontend/index.html',import.meta.url),'utf8');
const ID='0123abcd-0000-4000-8000-00000000beef';
const SCORE={value:3,items:Array.from({length:6},(_,i)=>({id:`s${i}`,status:i<3?'yes':'no'}))};
const scan={id:ID,status:'completed',score:SCORE,account:{username:'sample_card',url:'https://www.threads.com/@sample_card',name:null},posts:[{id:'p1'}],comments:[{id:'c1'},{id:'c2'}],analysis:{}};
const tag=(html,attr,name)=>html.match(new RegExp(`<meta ${attr}="${name}" content="([^"]*)"`))?.[1];
const texts=node=>typeof node==='string'?[node]:[node?.props?.children??[]].flat().flatMap(texts);
// Durable Object SQL over node:sqlite; BLOBs go in as ArrayBuffer like on Workers.
const fakeStorage=()=>{const db=new DatabaseSync(':memory:');return {sql:{exec(text,...params){const rows=db.prepare(text).all(...params.map(p=>p instanceof ArrayBuffer?new Uint8Array(p):p));return {toArray:()=>rows,one:()=>rows[0]};}}};};
const PNG=new Uint8Array([0x89,0x50,0x4e,0x47]);

test('the card says what the preview text says, and its version follows the content',()=>{
 const card=shareCard(scan,'集中回覆同一帳號。');
 assert.deepEqual(card,{username:'sample_card',headline:'6 項行為中 3 項值得注意',tone:'hit',lead:'集中回覆同一帳號。',counts:'1 篇貼文・2 則留言'});
 assert.deepEqual(texts(cardElement(card)),['w.','whospost','@sample_card','6 項行為中 3 項值得注意','集中回覆同一帳號。','1 篇貼文・2 則留言｜Threads 帳號行為檢查']);
 assert.equal(cardVersion(card),cardVersion({...card}));
 assert.notEqual(cardVersion(card),cardVersion(shareCard(scan,null)),'the AI conclusion arriving changes the image URL');
 assert.match(cardVersion(card),/^[0-9a-f]{8}$/);
 assert.equal(shareCard({...scan,score:{value:0,items:SCORE.items}},null).tone,'clear');
 assert.equal(shareCard({...scan,status:'running'},null),null);
 assert.ok(texts(cardElement(shareCard(scan,'長'.repeat(200))))[4].endsWith('…'),'long conclusions are clipped to fit');
});

test('a card is rendered once per version and read back from storage after that',async()=>{
 const renders=[];
 const core=new OgImageCore({storage:fakeStorage()},{render:async card=>{renders.push(card.lead);return PNG.slice().buffer;}});
 const card=shareCard(scan,null);
 assert.deepEqual([...await core.png(ID,card)],[...PNG]);
 assert.deepEqual([...await core.png(ID,card)],[...PNG]);
 assert.equal(renders.length,1);
 await core.png(ID,shareCard(scan,'新的 AI 結論'));
 assert.deepEqual(renders,[card.lead,'新的 AI 結論']);
 assert.equal(core.db.prepare('SELECT COUNT(*) AS n FROM og_images').get().n,1,'one stored image per scan');
});

test('a shared link points og:image at its versioned card; the card URL serves the PNG or falls back to the brand card',async()=>{
 const store={scanView:async id=>id===ID?scan:{...scan,status:'running'},aiInspect:async()=>({result:{status:'ready',result:{conclusion:'集中回覆同一帳號。'}}})};
 const calls=[];
 const ogStub={png:async(id,card)=>{calls.push([id,card.lead]);return PNG;}};
 const assets={fetch:async request=>{const path=new URL(request.url).pathname;return path==='/'?new Response(INDEX,{headers:{'content-type':'text/html; charset=utf-8'}}):path==='/og.png'?new Response('brand',{headers:{'content-type':'image/png'}}):new Response('asset');}};
 const app=(stub=ogStub,s=store)=>createWorkerApp({ASSETS:assets},{storeStub:s,ogStub:stub,startScan:()=>{}});
 const version=cardVersion(shareCard(scan,'集中回覆同一帳號。'));

 const html=await (await app()(new Request(`https://whospost.example/?scan=${ID}&from=share`))).text();
 assert.equal(tag(html,'property','og:image'),`https://whospost.example/api/og/${ID}.png?v=${version}`);
 assert.equal(tag(html,'name','twitter:image'),`https://whospost.example/api/og/${ID}.png?v=${version}`);
 assert.equal(tag(await (await app()(new Request('https://whospost.example/'))).text(),'property','og:image'),'https://whospost.example/og.png');

 const image=await app()(new Request(`https://whospost.example/api/og/${ID}.png?v=${version}`));
 assert.equal(image.headers.get('content-type'),'image/png');
 assert.equal(image.headers.get('cache-control'),'public, max-age=31536000, immutable');
 assert.deepEqual([...new Uint8Array(await image.arrayBuffer())],[...PNG]);
 assert.deepEqual(calls,[[ID,'集中回覆同一帳號。']]);
 const stale=await app()(new Request(`https://whospost.example/api/og/${ID}.png?v=00000000`));
 assert.equal(stale.headers.get('cache-control'),'public, max-age=300','an old version is served briefly, not pinned');

 const running=await app()(new Request('https://whospost.example/api/og/0123abcd-0000-4000-8000-000000000009.png'));
 assert.equal(await running.text(),'brand');assert.equal(running.headers.get('cache-control'),'public, max-age=300');
 const broken=await app({png:async()=>{throw Error('render failed')}})(new Request(`https://whospost.example/api/og/${ID}.png?v=${version}`));
 assert.equal(await broken.text(),'brand');
 const noStub=await app(null)(new Request(`https://whospost.example/api/og/${ID}.png`));
 assert.equal(await noStub.text(),'brand');
 assert.equal(calls.length,2,'only the two renderable requests reached the renderer');
});

test('the OG image Durable Object exposes every core method',()=>{
 const entry=readFileSync(new URL('../../worker/index.mjs',import.meta.url),'utf8');
 const missing=Object.getOwnPropertyNames(OgImageCore.prototype).filter(m=>m!=='constructor'&&!entry.includes(`this.core.${m}(`));
 assert.deepEqual(missing,[]);
});
