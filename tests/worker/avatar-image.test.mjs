import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {shareCard} from '../../worker/share-meta.mjs';
import {avatarVersion,avatarElement,AVATAR_SITE} from '../../worker/avatar-card.mjs';
import {cardVersion} from '../../worker/og-card.mjs';
import {OgImageCore} from '../../worker/og-object.mjs';
import {createWorkerApp} from '../../worker/app.mjs';

const INDEX=readFileSync(new URL('../../frontend/index.html',import.meta.url),'utf8');
const ID='0123abcd-0000-4000-8000-0000000000aa';
const items=(yes,unknown=0)=>Array.from({length:6},(_,i)=>({id:`s${i}`,status:i<yes?'yes':i>=6-unknown?'unknown':'no'}));
const scan={id:ID,status:'completed',score:{value:3,items:items(3)},account:{username:'sample_card',url:'https://www.threads.com/@sample_card',name:null},posts:Array.from({length:10},(_,i)=>({id:`p${i}`})),comments:Array.from({length:25},(_,i)=>({id:`c${i}`})),analysis:{}};
const texts=node=>typeof node==='string'?[node]:[node?.props?.children??[]].flat().flatMap(texts);
const nodes=node=>typeof node!=='object'||!node?[]:[node,...[node.props?.children??[]].flat().flatMap(nodes)];
const fakeStorage=()=>{const db=new DatabaseSync(':memory:');return {sql:{exec(text,...params){const rows=db.prepare(text).all(...params.map(p=>p instanceof ArrayBuffer?new Uint8Array(p):p));return {toArray:()=>rows,one:()=>rows[0]};}}};};
const PNG=new Uint8Array([0x89,0x50,0x4e,0x47]),OG=new Uint8Array([1,2,3]);
const body=card=>texts(avatarElement(card)).filter(t=>t!=='w.');

test('the avatar shows the account, the count out of six and the lead, in the three states, never as a verdict',()=>{
 const scored=shareCard(scan,'集中回覆同一帳號。');
 assert.deepEqual(body(scored),['@sample_card','3','／6','項值得注意','集中回覆同一帳號。',`10 篇貼文・25 則留言｜${AVATAR_SITE}`]);
 const zero=shareCard({...scan,score:{value:0,items:items(0)}},null);
 assert.deepEqual(body(zero).slice(1,4),['0','／6','未發現可疑行為']);
 const unscored=shareCard({...scan,score:{value:null,items:items(0,6)}},null);
 assert.deepEqual(body(unscored),['@sample_card','—','資料不足，暫不評分','資料不足，暫不判斷',`10 篇貼文・25 則留言｜${AVATAR_SITE}`]);
 for(const card of [scored,zero,unscored])for(const word of ['網軍','認證','通緝','嫌疑','安全','清白'])assert.ok(!body(card).join(' ').includes(word),`${word} must not appear in the card body`);
 assert.ok(texts(avatarElement(scored)).some(t=>t.includes(AVATAR_SITE)),'the site name is always on the image');
 // Nothing red: the count is ink, the colours only separate layers.
 const colours=nodes(avatarElement(scored)).flatMap(n=>Object.entries(n.props?.style??{}).filter(([k])=>/color|background|border/i.test(k)).map(([,v])=>String(v)));
 assert.ok(colours.every(c=>!/#(e[0-9a-f]5|ef5|b42|f00|ff0000)/i.test(c)),colours.join(' '));
 assert.ok(body(shareCard(scan,'長'.repeat(200)))[4].endsWith('…'),'long leads are clipped to one line');
 assert.equal(body(shareCard(scan,'長'.repeat(200)))[4].length,22);
 // Long handles shrink instead of overflowing the card.
 const size=name=>nodes(avatarElement(shareCard({...scan,account:{username:name}},null))).find(n=>typeof n.props?.children==='string'&&n.props.children===`@${name}`).props.style.fontSize;
 assert.equal(size('short'),58);assert.equal(size('a'.repeat(20)),46);assert.equal(size('a'.repeat(30)),36);
});

test('the avatar version follows its own content and layout, independent of the preview card version',()=>{
 const card=shareCard(scan,'集中回覆同一帳號。');
 assert.match(avatarVersion(card),/^[0-9a-f]{8}$/);
 assert.equal(avatarVersion(card),avatarVersion({...card}));
 assert.notEqual(avatarVersion(card),avatarVersion(shareCard(scan,null)),'the AI conclusion arriving changes the image URL');
 assert.notEqual(avatarVersion(card),avatarVersion({...card,username:'other'}));
 assert.notEqual(avatarVersion(card),avatarVersion({...card,hits:2,headline:'6 項行為中 2 項值得注意'}));
 assert.notEqual(avatarVersion(card),cardVersion(card),'not the preview card hash');
 assert.equal(avatarVersion({...card,lead:'長'.repeat(60)}),avatarVersion({...card,lead:'長'.repeat(60)+'尾'}),'text past the clip does not change the version');
});

test('avatars are stored next to preview cards: one of each per scan, rendered once per version',async()=>{
 const renders=[];
 const core=new OgImageCore({storage:fakeStorage()},{render:async()=>OG.slice().buffer,renderAvatar:async card=>{renders.push(card.lead);return PNG.slice().buffer;}});
 const card=shareCard(scan,null);
 assert.deepEqual([...await core.avatarPng(ID,card)],[...PNG]);
 assert.deepEqual([...await core.avatarPng(ID,card)],[...PNG]);
 assert.equal(renders.length,1);
 assert.deepEqual([...await core.png(ID,card)],[...OG],'the preview card is a separate image');
 assert.deepEqual([...await core.avatarPng(ID,card)],[...PNG],'storing a preview did not evict the avatar');
 await core.avatarPng(ID,shareCard(scan,'新的 AI 結論'));
 assert.deepEqual(renders,[card.lead,'新的 AI 結論']);
 assert.equal(core.db.prepare('SELECT COUNT(*) AS n FROM avatar_images').get().n,1,'one stored avatar per scan');
 assert.equal(core.db.prepare('SELECT COUNT(*) AS n FROM og_images').get().n,1);
});

test('GET /api/avatar/<id>.png serves the PNG with its version, pins a matching ?v=, and is 404 when it cannot be drawn',async()=>{
 const store={scanView:async id=>id===ID?scan:{...scan,status:'running'},aiInspect:async()=>({result:{status:'ready',result:{conclusion:'集中回覆同一帳號。'}}})};
 const calls=[];
 const ogStub={png:async()=>OG,avatarPng:async(id,card)=>{calls.push([id,card.lead]);return PNG;}};
 const assets={fetch:async request=>new URL(request.url).pathname==='/'?new Response(INDEX,{headers:{'content-type':'text/html; charset=utf-8'}}):new Response('brand',{headers:{'content-type':'image/png'}})};
 const app=(stub=ogStub)=>createWorkerApp({ASSETS:assets},{storeStub:store,ogStub:stub,startScan:()=>{}});
 const version=avatarVersion(shareCard(scan,'集中回覆同一帳號。'));

 const fresh=await app()(new Request(`https://whospost.example/api/avatar/${ID}.png`));
 assert.equal(fresh.status,200);
 assert.equal(fresh.headers.get('content-type'),'image/png');
 assert.equal(fresh.headers.get('x-avatar-version'),version);
 assert.equal(fresh.headers.get('content-disposition'),'inline; filename="whospost-sample_card.png"');
 assert.equal(fresh.headers.get('cache-control'),'public, max-age=300','without ?v= the image is served briefly, not pinned');
 assert.deepEqual([...new Uint8Array(await fresh.arrayBuffer())],[...PNG]);
 const pinned=await app()(new Request(`https://whospost.example/api/avatar/${ID}.png?v=${version}`));
 assert.equal(pinned.headers.get('cache-control'),'public, max-age=31536000, immutable');
 assert.equal((await app()(new Request(`https://whospost.example/api/avatar/${ID}.png?v=00000000`))).headers.get('cache-control'),'public, max-age=300');
 assert.deepEqual(calls,[[ID,'集中回覆同一帳號。'],[ID,'集中回覆同一帳號。'],[ID,'集中回覆同一帳號。']]);

 const running=await app()(new Request('https://whospost.example/api/avatar/0123abcd-0000-4000-8000-000000000009.png'));
 assert.equal(running.status,404);assert.equal(running.headers.get('content-type'),'application/json; charset=utf-8');
 const warned=[],original=console.warn;console.warn=(...a)=>warned.push(a);
 let broken;try{broken=await app({...ogStub,avatarPng:async()=>{throw Error('render failed')}})(new Request(`https://whospost.example/api/avatar/${ID}.png`));}finally{console.warn=original;}
 assert.equal(broken.status,404,'no brand-card fallback: the page must report the failure');
 assert.equal(warned.length,1);
 assert.equal((await app(null)(new Request(`https://whospost.example/api/avatar/${ID}.png`))).status,404);
 assert.equal((await app()(new Request(`https://whospost.example/api/avatar/not-a-uuid.png`))).status,404,'non-uuid paths fall through to the API');
 assert.equal((await app()(new Request(`https://whospost.example/api/avatar/${ID}.png`,{method:'POST'}))).status,404);
 assert.equal(calls.length,3,'only renderable requests reached the renderer');
});
