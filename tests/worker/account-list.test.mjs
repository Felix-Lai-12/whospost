import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {StoreObjectCore,BACKUP_TABLES} from '../../worker/store-object.mjs';
import {createWorkerApp} from '../../worker/app.mjs';
import {listEntry,aiSummary,hashUsername,LIST_VERSION,LIST_CACHE_KEY} from '../../worker/account-list.mjs';

// Same stand-ins as edge-cache.test.mjs: SQLite-backed Durable Object storage and a Cache API keyed by request URL.
function fakeStorage(){
 const db=new DatabaseSync(':memory:');
 return {sql:{exec(text,...params){const rows=db.prepare(text).all(...params);return {toArray:()=>rows,one:()=>rows[0]};}},
  transactionSync(fn){db.exec('BEGIN');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}},setAlarm(){},async get(){},async put(){},async delete(){}};
}
function fakeCaches(){
 const entries=new Map(),log=[];
 const key=r=>typeof r==='string'?r:r.url;
 return {log,entries,default:{
  async match(r){log.push(`match:${new URL(key(r)).pathname}`);const hit=entries.get(key(r));return hit?new Response(hit.body,{status:hit.status,headers:hit.headers}):undefined;},
  async put(r,res){log.push(`put:${new URL(key(r)).pathname}`);entries.set(key(r),{body:await res.arrayBuffer(),status:res.status,headers:[...res.headers]});},
  async delete(r){log.push(`delete:${new URL(key(r)).pathname}`);return entries.delete(key(r));}
 }};
}
const ENV={WHOSPOST_APIFY_LIMIT_USD:'2',WHOSPOST_DAILY_LIMIT_USD:'1',WHOSPOST_AI_LIMIT_USD:'1',GEMINI_API_KEY:'fixture-key'};
const SITE='https://whospost.example',EXPORT=`${SITE}/api/list/v1/export/threads-accounts.json`,APPEAL=`${SITE}/api/list/v1/appeal`;
const EXT=`chrome-extension://${'a'.repeat(32)}`,OTHER=`chrome-extension://${'b'.repeat(32)}`;
const sha256=text=>createHash('sha256').update(text).digest('hex');
const posts=(u,n,text)=>Array.from({length:n},(_,i)=>({id:`p${i}`,author:u,kind:'post',text,postedAt:'2026-10-01T00:00:00Z',url:`https://www.threads.com/@${u}/post/p${i}`}));
// A Worker app over a real data object, with the list route open and every list build counted.
function world({env={},edge=true,now}={}){
 const core=new StoreObjectCore({storage:fakeStorage()},ENV,{prompt:'fixture prompt',...(now?{now}:{})});
 let builds=0;const stub=new Proxy(core,{get:(t,k)=>k==='listEntries'?()=>{builds++;return t.listEntries();}:t[k]});
 const caches=edge?fakeCaches():undefined,pending=[];
 const app=createWorkerApp({...ENV,WHOSPOST_LIST_ENABLED:'1',ASSETS:{fetch:async()=>new Response('')},SCAN_RATE_LIMITER:{limit:async()=>({success:true})},...env},{storeStub:stub,startScan:()=>{},caches,waitUntil:p=>pending.push(p)});
 return {core,app,caches,pending,builds:()=>builds};
}
// Three accounts: six identical posts (the content-posts signal hits), a clean empty result, and a scan still running.
function seed(core){
 const hit=core.store.create('Sample_Hit');core.store.update(hit.id,{status:'completed',posts:posts('sample_hit',6,'這是一段完整且相同的內容'),completedAt:'2026-10-20T00:00:00Z'});
 const clean=core.store.create('sample_clean');core.store.update(clean.id,{status:'completed'});
 const running=core.store.create('sample_running');
 return {hit,clean,running};
}
const get=(app,url,headers={})=>app(new Request(url,{headers}));

test('the export lists one entry per completed account: the hash in place of the username, the site\'s score and hits, never a name',async()=>{
 const {core,app}=world();const {hit,clean}=seed(core);
 const r=await get(app,EXPORT);
 assert.equal(r.status,200);assert.equal(r.headers.get('Cache-Control'),'public, max-age=3600');assert.match(r.headers.get('ETag'),/^"[a-f0-9]{32}"$/);
 assert.equal(r.headers.get('X-Whospost-Cache'),'MISS');assert.equal(r.headers.get('Access-Control-Allow-Origin'),null,'no Origin header, no CORS header');
 const text=await r.text(),list=JSON.parse(text);
 for(const leak of ['sample_hit','Sample_Hit','sample_clean','sample_running','threads.com'])assert.equal(text.includes(leak),false,leak);
 assert.deepEqual(Object.keys(list),['license','attribution','generated','version','accounts']);
 assert.equal(list.license,'CC BY-SA 4.0');assert.equal(list.version,LIST_VERSION);assert.equal(LIST_VERSION,'signals-v2');assert.ok(Date.parse(list.generated));
 assert.equal(list.accounts.length,2,'the running scan is not listed');
 const a=list.accounts.find(x=>x.scanId===hit.id),b=list.accounts.find(x=>x.scanId===clean.id);
 assert.deepEqual(Object.keys(a),['h','score','hits','assessed','unknown','evidence','ai','scanId','updated','appeals']);
 assert.equal(a.h,sha256('sample_hit'),'sha256 of the lowercase username');assert.equal(a.h,await hashUsername('Sample_Hit'));
 assert.equal(a.score,core.scanView(hit.id).score.value);assert.equal(a.score,1);assert.deepEqual(a.hits,['content-posts']);
 assert.equal(a.assessed,1);assert.equal(a.unknown,5);assert.equal(a.evidence,'rules');assert.equal(a.ai,null);assert.equal(a.appeals,0);assert.ok(Date.parse(a.updated));
 assert.equal(b.score,null);assert.equal(b.unknown,6);assert.deepEqual(b.hits,[]);assert.equal(b.evidence,null);
});

test('a ready AI conclusion reaches the export as its first sentence with the account names removed; a flagged one does not',async()=>{
 const {core,app}=world();const {hit,clean}=seed(core);
 core.service.inspect=scan=>scan.account.username==='Sample_Hit'?{status:'ready',result:{conclusion:'@Sample_Hit 的貼文一再重複，常回覆 @other_user。其餘略。'},provenance:{model:'gemini-test'}}:{status:'ready',result:{conclusion:'一般帳號。',policyWarnings:['wording']},provenance:{model:'gemini-test'}};
 const text=await (await get(app,EXPORT)).text(),list=JSON.parse(text);
 assert.deepEqual(list.accounts.find(x=>x.scanId===hit.id).ai,{summary:'該帳號 的貼文一再重複，常回覆 該帳號。',version:'gemini-test'});
 assert.equal(list.accounts.find(x=>x.scanId===clean.id).ai,null,'the wording gate flagged it');
 for(const leak of ['Sample_Hit','other_user'])assert.equal(text.includes(leak),false,leak);
});

test('the export is built once, served from the edge for an hour regardless of the query string, and answers a matching If-None-Match with 304',async()=>{
 const {core,app,caches,pending,builds}=world();seed(core);
 const first=await get(app,EXPORT);await Promise.all(pending);const etag=first.headers.get('ETag');
 const second=await get(app,`${EXPORT}?v=2`);
 assert.equal(second.headers.get('X-Whospost-Cache'),'HIT');assert.equal(second.headers.get('ETag'),etag);assert.equal(await second.text(),await first.text());
 const same=await get(app,EXPORT,{'If-None-Match':etag});
 assert.equal(same.status,304);assert.equal(await same.text(),'');assert.equal(same.headers.get('ETag'),etag);assert.equal(same.headers.get('Cache-Control'),'public, max-age=3600');
 assert.equal((await get(app,EXPORT,{'If-None-Match':`W/"stale", ${etag}`})).status,304,'any listed tag may match');
 assert.equal((await get(app,EXPORT,{'If-None-Match':'"nope"'})).status,200);
 assert.equal(builds(),1,'the data object built the list once');
 assert.deepEqual(caches.log.filter(l=>l.startsWith('put:')),['put:/api/list/v1/export/threads-accounts.json']);
});

test('without an edge cache the data object still rebuilds at most once an hour: the cache row answers until it expires',async()=>{
 let t=Date.UTC(2026,9,23,0,0,0);const {core,app,builds}=world({edge:false,now:()=>t});seed(core);
 const original=core.store.scanView.bind(core.store);let views=0;core.store.scanView=id=>{views++;return original(id);};
 const a=await (await get(app,EXPORT)).json(),b=await (await get(app,EXPORT)).json();
 assert.equal(builds(),2,'every request reached the data object');assert.equal(views,2,'but the rows were read once: one view per completed account');assert.deepEqual(a,b);
 t+=3600000+1;const c=await (await get(app,EXPORT)).json();
 assert.equal(views,4,'after an hour the list is rebuilt');assert.notEqual(c.generated,a.generated);
});

test('buckets answer the requested 4-hex prefixes only, share one edge entry per canonical prefix set, and reject bad input',async()=>{
 const {core,app,pending}=world();const {hit}=seed(core);
 const p=sha256('sample_hit').slice(0,4),empty=['0000','1111'].find(x=>![sha256('sample_hit'),sha256('sample_clean')].some(h=>h.startsWith(x)));
 const r=await get(app,`${SITE}/api/list/v1/buckets?p=${p},${empty}`);
 assert.equal(r.status,200);assert.equal(r.headers.get('Cache-Control'),'public, max-age=3600');assert.match(r.headers.get('ETag'),/^"[a-f0-9]{32}"$/);
 const body=await r.json();
 assert.deepEqual(Object.keys(body).sort(),[p,empty].sort());assert.equal(body[p].length,1);assert.equal(body[p][0].scanId,hit.id);assert.equal(body[p][0].h,sha256('sample_hit'));assert.deepEqual(body[empty],[]);
 await Promise.all(pending);
 const again=await get(app,`${SITE}/api/list/v1/buckets?p=${empty},${p.toUpperCase()},${p}`);
 assert.equal(again.headers.get('X-Whospost-Cache'),'HIT','order, case and repeats do not fragment the cache');assert.deepEqual(await again.json(),body);
 assert.equal((await get(app,`${SITE}/api/list/v1/buckets?p=${p}`,{'If-None-Match':'"x"'})).status,200);
 const sixtyFive=Array.from({length:65},(_,i)=>i.toString(16).padStart(4,'0')).join(',');
 for(const bad of ['','zzzz','abc','abcde',`${p},xyz1`,sixtyFive]){const res=await get(app,`${SITE}/api/list/v1/buckets?p=${bad}`);assert.equal(res.status,400,bad||'(empty)');}
 assert.equal((await get(app,`${SITE}/api/list/v1/buckets`)).status,400,'p is required');
});

test('an appeal is accepted only from an extension origin, counted once per installation, rate limited, backed up, and refreshes the list without touching the score',async()=>{
 const keys=[];let allow=true;
 const {core,app,caches,pending}=world({env:{SCAN_RATE_LIMITER:{limit:async({key})=>{keys.push(key);return {success:allow};}}}});
 const {hit}=seed(core);const h=sha256('sample_hit');
 const post=(body,headers={})=>app(new Request(APPEAL,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:typeof body==='string'?body:JSON.stringify(body)}));
 await get(app,EXPORT);await Promise.all(pending);
 const appeal={h,installHash:'1'.repeat(64)};
 assert.equal((await post(appeal)).status,403,'no origin');
 assert.equal((await post(appeal,{Origin:SITE})).status,403,'the site itself cannot appeal');
 assert.equal((await post(appeal,{Origin:'chrome-extension://short'})).status,403,'not an extension id');
 assert.equal(keys.length,0,'refused origins never reach the rate limiter');
 const ok=await post(appeal,{Origin:EXT});
 assert.equal(ok.status,200);assert.equal(ok.headers.get('Access-Control-Allow-Origin'),EXT);assert.deepEqual(await ok.json(),{ok:true,recorded:true});
 assert.deepEqual(await (await post(appeal,{Origin:EXT})).json(),{ok:true,recorded:false},'same installation, same account: counted once');
 assert.equal((await post({...appeal,installHash:'2'.repeat(64),reason:'認識本人'},{Origin:EXT})).status,200);
 for(const bad of [{h:'xyz',installHash:'1'.repeat(64)},{h,installHash:'1'.repeat(10)},{h:h.toUpperCase(),installHash:'1'.repeat(64)},{h,installHash:'1'.repeat(64),reason:'x'.repeat(501)},{h,installHash:'1'.repeat(64),reason:5},'not json',{},'[]']){
  const res=await post(bad,{Origin:EXT});assert.equal(res.status,400,JSON.stringify(bad));assert.equal(res.headers.get('Access-Control-Allow-Origin'),EXT);
 }
 assert.equal((await post({h,installHash:'3'.repeat(64),reason:'x'.repeat(2049)},{Origin:EXT})).status,413);
 allow=false;const limited=await post({h,installHash:'4'.repeat(64)},{Origin:EXT});allow=true;
 assert.equal(limited.status,429);assert.equal((await limited.json()).code,'RATE_LIMITED');
 assert.ok(keys.length>0&&keys.every(k=>k.startsWith('appeal:')),'appeals count under their own limiter keys');
 await Promise.all(pending);
 assert.deepEqual(caches.log.filter(l=>l.startsWith('delete:')),Array(2).fill('delete:/api/list/v1/export/threads-accounts.json'),'each recorded appeal drops the edge copy; repeats and refusals do not');
 const fresh=await get(app,EXPORT);assert.equal(fresh.headers.get('X-Whospost-Cache'),'MISS');
 const entry=(await fresh.json()).accounts.find(a=>a.scanId===hit.id);
 assert.equal(entry.appeals,2);assert.equal(entry.score,1,'appeals never change the score');assert.equal(entry.evidence,'rules');
 assert.equal(core.store.cacheGet(LIST_CACHE_KEY)?.accounts.find(a=>a.scanId===hit.id).appeals,2,'the rebuilt list is cached again');
 const rows=core.store.db.prepare('SELECT h,install_hash,reason FROM appeals ORDER BY install_hash').all().map(r=>({...r}));
 assert.deepEqual(rows,[{h,install_hash:'1'.repeat(64),reason:''},{h,install_hash:'2'.repeat(64),reason:'認識本人'}]);
 assert.ok(BACKUP_TABLES.has('appeals'));assert.equal(core.exportPage('appeals').rows.length,2,'the nightly backup includes appeals');
});

test('CORS: any chrome-extension origin in development, only the configured IDs once set; the edge copy carries no origin',async()=>{
 const {core,app,pending}=world();seed(core);
 const a=await get(app,EXPORT,{Origin:EXT});
 assert.equal(a.headers.get('Access-Control-Allow-Origin'),EXT);assert.equal(a.headers.get('Vary'),'Origin');assert.equal(a.headers.get('Access-Control-Expose-Headers'),'ETag');
 await Promise.all(pending);
 const b=await get(app,EXPORT,{Origin:OTHER});
 assert.equal(b.headers.get('X-Whospost-Cache'),'HIT');assert.equal(b.headers.get('Access-Control-Allow-Origin'),OTHER,'the cached copy is re-stamped per request');
 const c=await get(app,EXPORT,{Origin:'https://evil.example'});
 assert.equal(c.status,200,'the export is public; a web page just gets no CORS header');assert.equal(c.headers.get('Access-Control-Allow-Origin'),null);
 const pre=await app(new Request(EXPORT,{method:'OPTIONS',headers:{Origin:EXT,'Access-Control-Request-Method':'GET'}}));
 assert.equal(pre.status,204);assert.equal(pre.headers.get('Access-Control-Allow-Origin'),EXT);assert.equal(pre.headers.get('Access-Control-Allow-Methods'),'GET, POST, OPTIONS');
 assert.equal((await app(new Request(EXPORT,{method:'OPTIONS',headers:{Origin:'https://evil.example'}}))).status,403);
 const strict=world({env:{WHOSPOST_EXTENSION_IDS:` ${'a'.repeat(32)} , ${'c'.repeat(32)}`}});seed(strict.core);
 assert.equal((await get(strict.app,EXPORT,{Origin:EXT})).headers.get('Access-Control-Allow-Origin'),EXT);
 assert.equal((await get(strict.app,EXPORT,{Origin:OTHER})).headers.get('Access-Control-Allow-Origin'),null);
 assert.equal((await strict.app(new Request(APPEAL,{method:'POST',headers:{Origin:OTHER},body:'{}'}))).status,403);
 assert.equal((await strict.app(new Request(APPEAL,{method:'OPTIONS',headers:{Origin:OTHER}}))).status,403);
});

test('without WHOSPOST_LIST_ENABLED=1 every list route is a 404, preflight included',async()=>{
 for(const flag of [undefined,'0','true']){
  const {core,app}=world({env:{WHOSPOST_LIST_ENABLED:flag}});seed(core);
  for(const [method,path,headers] of [['GET','/api/list/v1/export/threads-accounts.json'],['GET','/api/list/v1/buckets?p=abcd'],['POST','/api/list/v1/appeal',{Origin:EXT}],['OPTIONS','/api/list/v1/appeal',{Origin:EXT}],['GET','/api/list/v1/anything']]){
   const r=await app(new Request(SITE+path,{method,headers}));assert.equal(r.status,404,`${flag}: ${method} ${path}`);
  }
  assert.equal((await get(app,`${SITE}/api/health`)).status,200,'the rest of the API is untouched');
 }
});

test('aiSummary: the first sentence, every account name removed, only when the wording gate passed',()=>{
 const scan={status:'completed',id:'s',account:{username:'sample_hit',name:'小明'},posts:[],comments:[]};
 const ready=(conclusion,extra={})=>({status:'ready',result:{conclusion,...extra},provenance:{model:'gemini-test'}});
 assert.deepEqual(aiSummary(ready('@Sample_Hit（小明）的留言高度重複，常回覆 @other_user！第二句不放。'),scan),{summary:'該帳號（該帳號）的留言高度重複，常回覆 該帳號！',version:'gemini-test'});
 assert.deepEqual(aiSummary(ready('沒有句號的一句話'),scan),{summary:'沒有句號的一句話',version:'gemini-test'});
 assert.equal(aiSummary(ready('x'.repeat(300)),scan).summary.length,200);
 assert.equal(aiSummary(ready('x',{policyWarnings:['wording']}),scan),null);
 assert.equal(aiSummary({status:'processing'},scan),null);assert.equal(aiSummary(null,scan),null);assert.equal(aiSummary({status:'ready',result:{}},scan),null);
});

test('listEntry: null unless completed with a Threads username; evidence falls from rules to ai to appeal to null',async()=>{
 const base={status:'completed',id:'s',account:{username:'sample_clean'},posts:[],comments:[]};
 const ai={status:'ready',result:{conclusion:'看起來像一般帳號。'},provenance:{}};
 assert.equal(await listEntry({...base,status:'running'}),null);assert.equal(await listEntry({...base,account:{username:'bad name!'}}),null);assert.equal(await listEntry(null),null);
 assert.equal((await listEntry(base)).evidence,null);
 assert.equal((await listEntry(base,{appeals:1})).evidence,'appeal');
 assert.equal((await listEntry(base,{appeals:1,ai})).evidence,'ai');
 const hit={...base,account:{username:'sample_hit'},posts:posts('sample_hit',6,'這是一段完整且相同的內容')};
 const entry=await listEntry(hit,{appeals:1,ai,updated:'2026-10-23T00:00:00.000Z'});
 assert.equal(entry.evidence,'rules');assert.equal(entry.updated,'2026-10-23T00:00:00.000Z');assert.deepEqual(entry.ai,{summary:'看起來像一般帳號。',version:null});
});
