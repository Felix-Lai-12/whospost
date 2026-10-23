import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {StoreObjectCore,BACKUP_TABLES} from '../../worker/store-object.mjs';
import {createWorkerApp} from '../../worker/app.mjs';
import {setLogSink} from '../../worker/log.mjs';
import {parseReport,taipeiDay,COUNTERS,COUNT_MAX} from '../../worker/ext-telemetry.mjs';

// The same stand-ins as account-list.test.mjs: SQLite-backed Durable Object storage behind the Worker app.
function fakeStorage(){
 const db=new DatabaseSync(':memory:');
 return {sql:{exec(text,...params){const rows=db.prepare(text).all(...params);return {toArray:()=>rows,one:()=>rows[0]};}},
  transactionSync(fn){db.exec('BEGIN');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}},setAlarm(){},async get(){},async put(){},async delete(){}};
}
const ENV={WHOSPOST_APIFY_LIMIT_USD:'2',WHOSPOST_DAILY_LIMIT_USD:'1',WHOSPOST_AI_LIMIT_USD:'1',GEMINI_API_KEY:'fixture-key'};
const SITE='https://whospost.example',TELEMETRY=`${SITE}/api/list/v1/telemetry`,ADMIN=`${SITE}/api/admin/ext-telemetry`;
const EXT=`chrome-extension://${'a'.repeat(32)}`;
// 2026-10-23 12:00 Taipei.
const NOON=Date.UTC(2026,9,23,4,0,0);
function world({env={},now=()=>NOON,limiter}={}){
 const core=new StoreObjectCore({storage:fakeStorage()},ENV,{prompt:'fixture prompt',now});
 const app=createWorkerApp({...ENV,WHOSPOST_LIST_ENABLED:'1',ADMIN_TOKEN:'admin-fixture',ASSETS:{fetch:async()=>new Response('')},SCAN_RATE_LIMITER:limiter??{limit:async()=>({success:true})},...env},{storeStub:core,startScan:()=>{}});
 const post=(body,headers={Origin:EXT})=>app(new Request(TELEMETRY,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:typeof body==='string'?body:JSON.stringify(body)}));
 const summary=async(days)=>(await app(new Request(ADMIN,{method:'POST',headers:{authorization:'Bearer admin-fixture'},body:JSON.stringify(days===undefined?{}:{days})}))).json();
 return {core,app,post,summary};
}
const daily=(over={})=>({kind:'daily',v:'0.3.0',day:'2026-10-23',pages:3,compared:40,listed:5,flagged:2,thread:3,collapsed:4,trusted:1,...over});

test('parseReport keeps only the known fields: kind, version, a real day within two days of today, whole counters up to COUNT_MAX',()=>{
 assert.equal(taipeiDay(NOON),'2026-10-23');
 const ok=parseReport({...daily(),extra:'x',h:'f'.repeat(64)},NOON);
 assert.equal(ok.ok,true);assert.deepEqual(Object.keys(ok.report),['kind','v','day',...COUNTERS]);assert.equal(ok.report.compared,40);assert.equal('extra' in ok.report,false);
 assert.deepEqual(parseReport({kind:'daily',v:'0.3.0',day:'2026-10-22'},NOON).report,{kind:'daily',v:'0.3.0',day:'2026-10-22',pages:0,compared:0,listed:0,flagged:0,thread:0,collapsed:0,trusted:0},'missing counters are 0');
 const broken=parseReport({kind:'dom_broken',v:'0.3.0',day:'2026-10-23',compared:999},NOON);
 assert.equal(broken.ok,true);assert.equal(broken.report.compared,0,'a dom_broken notice carries no counters');
 for(const day of ['2026-10-21','2026-10-25'])assert.equal(parseReport(daily({day}),NOON).ok,true,`${day} is within the skew`);
 for(const bad of [null,[],'x',{},daily({kind:'weekly'}),daily({v:'1.0'}),daily({v:'0.3.0-beta'}),daily({v:1}),daily({day:'2026-2-3'}),daily({day:'2026-02-31'}),daily({day:'2026-10-20'}),daily({day:'2026-10-26'}),daily({compared:-1}),daily({compared:1.5}),daily({compared:'40'}),daily({trusted:COUNT_MAX+1}),daily({pages:null})]){
  assert.deepEqual(parseReport(bad,NOON),{ok:false,code:'INVALID_REPORT'},JSON.stringify(bad));
 }
 assert.equal(parseReport(daily({compared:COUNT_MAX}),NOON).ok,true);
});

test('daily reports are summed per (day, version, kind); a report counts one installation-day; the admin summary reads them newest first',async()=>{
 const {core,post,summary}=world();
 const a=await post(daily());
 assert.equal(a.status,200);assert.equal(a.headers.get('Access-Control-Allow-Origin'),EXT);assert.deepEqual(await a.json(),{ok:true});
 assert.equal((await post(daily({pages:1,compared:10,listed:0,flagged:0,thread:1,collapsed:0,trusted:2}))).status,200);
 assert.equal((await post(daily({v:'0.2.0',day:'2026-10-22',pages:1,compared:5}))).status,200);
 const rows=core.store.db.prepare('SELECT * FROM ext_telemetry ORDER BY day,version').all().map(r=>({...r}));
 assert.equal(rows.length,2);
 assert.deepEqual({...rows[1],updated_at:undefined},{day:'2026-10-23',version:'0.3.0',kind:'daily',reports:2,pages:4,compared:50,listed:5,flagged:2,thread:4,collapsed:4,trusted:3,updated_at:undefined});
 assert.equal(rows[0].version,'0.2.0');assert.equal(rows[0].reports,1);assert.equal(rows[0].compared,5);
 assert.equal(rows[1].updated_at,new Date(NOON).toISOString());
 const s=await summary();
 assert.equal(s.days,14);assert.equal(s.since,'2026-10-10');assert.deepEqual(s.rows.map(r=>[r.day,r.version,r.kind,r.reports]),[['2026-10-23','0.3.0','daily',2],['2026-10-22','0.2.0','daily',1]]);
 assert.deepEqual(Object.keys(s.rows[0]),['day','version','kind','reports',...COUNTERS,'updated_at']);
 const one=await summary(1);assert.equal(one.since,'2026-10-23');assert.equal(one.rows.length,1,'only today');
 assert.equal((await summary(1000)).days,90,'capped');assert.equal((await summary('junk')).days,14);
});

test('a dom_broken notice is counted apart from the daily rows and logged as ext.dom_broken with the version only',async()=>{
 const lines=[];const restore=setLogSink((level,line)=>lines.push([level,JSON.parse(line)]));
 try{
  const {core,post}=world();
  assert.equal((await post({kind:'dom_broken',v:'0.3.0',day:'2026-10-23'})).status,200);
  assert.equal((await post({kind:'dom_broken',v:'0.3.0',day:'2026-10-23'})).status,200);
  assert.equal((await post(daily())).status,200);
  const rows=core.store.db.prepare('SELECT kind,reports,compared FROM ext_telemetry ORDER BY kind').all().map(r=>({...r}));
  assert.deepEqual(rows,[{kind:'daily',reports:1,compared:40},{kind:'dom_broken',reports:2,compared:0}]);
  const broken=lines.filter(([,l])=>l.event==='ext.dom_broken');
  assert.equal(broken.length,2);assert.deepEqual(broken[0],['warn',{level:'warn',event:'ext.dom_broken',version:'0.3.0',day:'2026-10-23'}]);
  assert.equal(lines.some(([,l])=>l.event!=='ext.dom_broken'&&l.event!=='request'&&l.event!=='gate.denied'),false,'nothing else is logged per report');
 }finally{restore();}
});

test('refusals: extension origins only, 400 for a malformed report, 413 past 1 KB, 429 under its own limiter keys; nothing malformed is stored',async()=>{
 const keys=[];let allow=true;
 const {core,post}=world({limiter:{limit:async({key})=>{keys.push(key);return {success:allow};}}});
 assert.equal((await post(daily(),{})).status,403,'no origin');
 assert.equal((await post(daily(),{Origin:SITE})).status,403,'the site itself cannot report');
 assert.equal(keys.length,0,'refused origins never reach the limiter');
 for(const bad of [daily({kind:'weekly'}),daily({day:'2026-10-01'}),daily({compared:-1}),'not json','[]',{}]){
  const r=await post(bad);assert.equal(r.status,400,JSON.stringify(bad));assert.equal(r.headers.get('Access-Control-Allow-Origin'),EXT);
  if(typeof bad!=='string')assert.equal((await r.json()).code??'INVALID_REPORT','INVALID_REPORT');
 }
 assert.equal((await post({...daily(),pad:'x'.repeat(1100)})).status,413);
 allow=false;const limited=await post(daily());allow=true;
 assert.equal(limited.status,429);assert.equal((await limited.json()).code,'RATE_LIMITED');
 assert.ok(keys.length>0&&keys.every(k=>k.startsWith('telemetry:')),'telemetry counts under its own limiter keys');
 assert.equal(core.store.db.prepare('SELECT COUNT(*) AS n FROM ext_telemetry').get().n,0);
 assert.equal((await post(daily())).status,200);
});

test('the admin summary needs the admin token and POST; the table is in the nightly backup',async()=>{
 const {core,app,post}=world();
 await post(daily());
 assert.equal((await app(new Request(ADMIN,{method:'POST'}))).status,401);
 assert.equal((await app(new Request(ADMIN,{method:'GET',headers:{authorization:'Bearer admin-fixture'}}))).status,404);
 assert.equal((await app(new Request(ADMIN,{method:'POST',headers:{authorization:'Bearer wrong'}}))).status,401);
 const closed=createWorkerApp({...ENV,ASSETS:{fetch:async()=>new Response('')}},{storeStub:core,startScan:()=>{}});
 assert.equal((await closed(new Request(ADMIN,{method:'POST',headers:{authorization:'Bearer admin-fixture'}}))).status,404,'no ADMIN_TOKEN, no route');
 const r=await app(new Request(ADMIN,{method:'POST',headers:{authorization:'Bearer admin-fixture'}}));
 assert.equal(r.status,200);assert.equal((await r.json()).rows.length,1,'an empty body means the default window');
 assert.ok(BACKUP_TABLES.has('ext_telemetry'));assert.equal(core.exportPage('ext_telemetry').rows.length,1);
});

test('without WHOSPOST_LIST_ENABLED=1 the telemetry route is a 404 like the rest of the list API',async()=>{
 const {post}=world({env:{WHOSPOST_LIST_ENABLED:'0'}});
 assert.equal((await post(daily())).status,404);
});
