import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {shareMeta,withShareMeta,scoreHeadline} from '../../worker/share-meta.mjs';
import {createWorkerApp} from '../../worker/app.mjs';

const INDEX=readFileSync(new URL('../../frontend/index.html',import.meta.url),'utf8');
const ID='0123abcd-0000-4000-8000-00000000abcd';
const SCORE={value:4,items:Array.from({length:6},(_,i)=>({id:`s${i}`,status:i<4?'yes':'no'}))};
const scan={id:ID,status:'completed',score:SCORE,account:{username:'sample_share',url:'https://www.threads.com/@sample_share',name:null},posts:[{id:'p1'},{id:'p2'}],comments:[{id:'c1'}],analysis:{}};
const tag=(html,attr,name)=>html.match(new RegExp(`<meta ${attr}="${name}" content="([^"]*)"`))?.[1];
const assets={fetch:async request=>new URL(request.url).pathname==='/'?new Response(INDEX,{headers:{'content-type':'text/html; charset=utf-8',etag:'"x"'}}):new Response('asset')};
const app=(store,env={})=>createWorkerApp({ASSETS:assets,...env},{storeStub:store,startScan:()=>{}});

test('index.html ships site-wide preview tags with the brand card',()=>{
 for(const [attr,name] of [['property','og:title'],['property','og:description'],['property','og:image'],['property','og:url'],['name','twitter:card'],['name','description']])assert.ok(tag(INDEX,attr,name),name);
 assert.equal(tag(INDEX,'property','og:image'),'/og.png');
 const png=readFileSync(new URL('../../frontend/public/og.png',import.meta.url));
 assert.deepEqual([png.readUInt32BE(16),png.readUInt32BE(20)],[1200,630]);
});

test('preview text uses the AI conclusion, falls back to the signal summary, and is clipped',()=>{
 assert.deepEqual(shareMeta(scan,'這個帳號反覆貼同一句口號。'),{title:'@sample_share｜8 項中 4 項值得注意｜Whospost',description:'這個帳號反覆貼同一句口號。（2 篇貼文・1 則留言）'});
 assert.match(shareMeta(scan,null).description,/（2 篇貼文・1 則留言）$/);
 assert.ok(shareMeta(scan,'長'.repeat(300)).description.startsWith('長'.repeat(109)+'…'));
 assert.equal(shareMeta({...scan,status:'running'},'x'),null);
 assert.equal(shareMeta(null,'x'),null);
});

test('the title verdict covers hits, none and missing data, and is computed when the view has no score',()=>{
 assert.equal(scoreHeadline(SCORE),'6 項中 4 項值得注意');
 assert.equal(scoreHeadline({value:0,items:SCORE.items}),'未發現可疑跡象');
 assert.equal(scoreHeadline({value:null,items:SCORE.items}),'資料不足');
 assert.equal(scoreHeadline(null),'資料不足');
 const {score,...bare}=scan;
 assert.match(shareMeta(bare,'x').title,/^@sample_share｜(資料不足|未發現可疑跡象|\d 項中 \d 項值得注意)｜Whospost$/);
});

test('the AI judgements are items 7 and 8: each yes adds one, pending never reads as nothing found (signals-v3)',()=>{
 assert.equal(shareMeta(scan,'x',{behavior:'yes'}).title,'@sample_share｜8 項中 5 項值得注意｜Whospost');
 assert.equal(shareMeta(scan,'x',{behavior:'yes',content:'yes'}).title,'@sample_share｜8 項中 6 項值得注意｜Whospost');
 assert.equal(shareMeta(scan,'x',{behavior:'no',content:'no'}).title,'@sample_share｜8 項中 4 項值得注意｜Whospost');
 const clear={...scan,score:{value:0,assessed:6,items:SCORE.items.map(i=>({...i,status:'no'}))}};
 assert.equal(shareMeta(clear,null,{behavior:'no',content:'pending'}).title,'@sample_share｜AI 判讀中｜Whospost','either judgement still running: not 未發現');
 assert.equal(shareMeta(clear,null,{behavior:'unknown',content:'unknown'}).title,'@sample_share｜未發現可疑跡象｜Whospost');
 assert.equal(shareMeta(clear,'x',{content:'yes'}).title,'@sample_share｜8 項中 1 項值得注意｜Whospost');
 // No AI conclusion to lead with: the six-rule summary would say nothing showed up under a headline that says one did.
 const lead=shareMeta(clear,null,{content:'yes'});assert.equal(lead.title,'@sample_share｜8 項中 1 項值得注意｜Whospost');
 assert.match(lead.description,/^六項規則沒有出現，AI 判讀標出值得注意的地方/);
 assert.doesNotMatch(shareMeta(scan,null,{content:'yes'}).description,/六項規則沒有出現/,'with a rule hit the summary stands');
 assert.equal(scoreHeadline({value:null,items:[],pending:true}),'AI 判讀中');
});

test('rewritten tags are escaped',()=>{
 const html=withShareMeta(INDEX,{title:'a"<b>&',description:'x" onload="y',url:'https://w.example/',image:'https://w.example/og.png'});
 assert.equal(tag(html,'property','og:title'),'a&quot;&lt;b&gt;&amp;');
 assert.match(html,/<title>a&quot;&lt;b&gt;&amp;<\/title>/);
 assert.equal(tag(html,'name','twitter:description'),'x&quot; onload=&quot;y');
});

test('a shared scan link gets that account in its preview; anything else gets the site preview',async()=>{
 const calls=[];
 const store={scanView:async id=>{calls.push(id);return id===ID?scan:null;},aiInspect:async()=>({account:'sample_share',result:{status:'ready',result:{conclusion:'集中回覆同一帳號。'}}})};
 const shared=await app(store)(new Request(`https://whospost.example/?scan=${ID}&from=share`));
 const html=await shared.text();
 assert.equal(tag(html,'property','og:title'),'@sample_share｜8 項中 4 項值得注意｜Whospost');
 assert.equal(tag(html,'property','og:description'),'集中回覆同一帳號。（2 篇貼文・1 則留言）');
 assert.equal(tag(html,'property','og:url'),`https://whospost.example/?scan=${ID}`);
 assert.equal(tag(html,'property','og:image'),'https://whospost.example/og.png');
 assert.equal(shared.headers.get('etag'),null,'per-scan HTML must not reuse the static ETag');
 assert.match(html,/<div id="root"><\/div>/,'the app shell is untouched');

 for(const url of ['https://whospost.example/','https://whospost.example/?scan=not-a-uuid','https://whospost.example/?scan=ffffffff-0000-4000-8000-000000000000']){
  const page=await (await app(store)(new Request(url))).text();
  assert.equal(tag(page,'property','og:title'),'Whospost｜看懂帳號背後的線索',url);
  assert.equal(tag(page,'property','og:image'),'https://whospost.example/og.png');
 }
 assert.ok(!calls.includes('not-a-uuid'),'malformed IDs never reach the data object');

 // Completed views are cached per isolate, so each case below uses its own scan ID.
 const pending=await (await app({scanView:async()=>({...scan,status:'running'}),aiInspect:async()=>{throw Error('not called')}})(new Request('https://whospost.example/?scan=0123abcd-0000-4000-8000-000000000001'))).text();
 assert.equal(tag(pending,'property','og:title'),'Whospost｜看懂帳號背後的線索');
 const broken=await app({scanView:async()=>{throw Error('data object down')},aiInspect:async()=>null})(new Request('https://whospost.example/?scan=0123abcd-0000-4000-8000-000000000002'));
 assert.equal(broken.status,200);assert.equal(tag(await broken.text(),'property','og:title'),'Whospost｜看懂帳號背後的線索');
 const noAi=await (await app({scanView:async()=>scan,aiInspect:async()=>({result:{status:'processing'}})})(new Request('https://whospost.example/?scan=0123abcd-0000-4000-8000-000000000003'))).text();
 assert.match(tag(noAi,'property','og:description'),/（2 篇貼文・1 則留言）$/);
});
