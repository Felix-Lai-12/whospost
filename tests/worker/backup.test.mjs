import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {StoreObjectCore,BACKUP_TABLES} from '../../worker/store-object.mjs';
import {createWorkerApp} from '../../worker/app.mjs';
import {runBackup,pruneBackups,taipeiDate,BACKUP_SCHEMA_VERSION} from '../../worker/backup.mjs';

function fakeStorage(){
 const db=new DatabaseSync(':memory:');
 return {sql:{exec(text,...params){const rows=db.prepare(text).all(...params);return {toArray:()=>rows,one:()=>rows[0]};}},
  transactionSync(fn){db.exec('BEGIN');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}},setAlarm(){}};
}
// Fake R2: put/list(prefix, delimiter, cursor)/delete over a sorted Map, with small list pages to exercise cursors.
function fakeBucket({pageLimit=2}={}){
 const objects=new Map(),calls=[];
 return {objects,calls,
  async put(key,body,options){calls.push(`put:${key}`);objects.set(key,{body,contentType:options?.httpMetadata?.contentType});},
  async delete(keys){for(const k of [keys].flat()){calls.push(`delete:${k}`);objects.delete(k);}},
  async list({prefix='',delimiter,cursor}={}){
   const keys=[...objects.keys()].filter(k=>k.startsWith(prefix)).sort(),start=cursor?Number(cursor):0,items=[],prefixes=new Set();
   for(const k of keys){const rest=k.slice(prefix.length),i=delimiter?rest.indexOf(delimiter):-1;if(i>=0)prefixes.add(prefix+rest.slice(0,i+1));else items.push(k);}
   const page=delimiter?[...prefixes]:items,slice=page.slice(start,start+pageLimit),truncated=start+pageLimit<page.length;
   return {objects:delimiter?[]:slice.map(key=>({key})),delimitedPrefixes:delimiter?slice:[],truncated,cursor:truncated?String(start+pageLimit):undefined};
  }};
}
const ENV={WHOSPOST_APIFY_LIMIT_USD:'2',WHOSPOST_DAILY_LIMIT_USD:'0',WHOSPOST_AI_LIMIT_USD:'1',WHOSPOST_AI_ENABLED:'0'};
const dataObject=()=>new StoreObjectCore({storage:fakeStorage()},ENV,{prompt:'fixture'});
const T0=Date.UTC(2026,9,21,20,0,0); // 2026-10-21 20:00 UTC = 2026-10-22 04:00 Taipei
const lines=text=>text.split('\n').filter(Boolean).map(l=>JSON.parse(l));

test('taipeiDate files the 20:00 UTC run under the next Taipei morning',()=>{
 assert.equal(taipeiDate(T0),'2026-10-22');
 assert.equal(taipeiDate(Date.UTC(2026,9,21,15,59)),'2026-10-21');
});

test('exportPage walks a table by rowid cursor without reading it whole',()=>{
 const core=dataObject();
 for(let i=0;i<7;i++)core.store.create(`hkj315_${i}`);
 const a=core.exportPage('scans',0,3),b=core.exportPage('scans',a.next,3),c=core.exportPage('scans',b.next,3);
 assert.deepEqual([a.rows.length,b.rows.length,c.rows.length],[3,3,1]);
 assert.equal(c.next,null);
 assert.deepEqual([...a.rows,...b.rows,...c.rows].map(r=>r.username),[0,1,2,3,4,5,6].map(i=>`hkj315_${i}`));
 assert.throws(()=>core.exportPage('sqlite_master'),/unknown table/);
 assert.throws(()=>core.exportPage('cache'),/unknown table/,'transient tables are not exported');
});

test('runBackup writes one JSONL per table plus a manifest, reading pages until the cursor ends',async()=>{
 const core=dataObject(),bucket=fakeBucket();
 const scan=core.store.create('hkj315');core.store.update(scan.id,{status:'completed',posts:[]});
 core.saveEvidence(scan.id,[{id:'p1',author:'hkj315',kind:'post',text:'中文 "quoted" 內容\n換行',postedAt:'2026-10-01T00:00:00Z',url:'https://www.threads.com/@hkj315/post/p1'}]);
 core.budgetReserve('x:posts',.1);core.pledge('hash-1');core.pledge('hash-2');
 for(let i=0;i<5;i++)core.store.create(`hkj331155_${i}`);
 let t=T0;const manifest=await runBackup({storeStub:core,bucket,now:()=>t+=1000,pageSize:2});
 assert.equal(manifest.date,'2026-10-22');assert.equal(manifest.schemaVersion,BACKUP_SCHEMA_VERSION);
 assert.equal(manifest.exportedAt,'2026-10-21T20:00:01.000Z');assert.ok(manifest.finishedAt>manifest.exportedAt);
 assert.deepEqual(manifest.tables,[...BACKUP_TABLES]);
 assert.deepEqual(manifest.rows,{scans:6,evidence:1,observations:1,analysis_runs:0,budget:1,scan_requests:0,ip_quota:0,pledges:2,ai_meta:1,ai_jobs:0,ai_attempts:0});
 assert.deepEqual(manifest.deleted,[]);
 const keys=[...bucket.objects.keys()].sort();
 assert.deepEqual(keys,[...[...BACKUP_TABLES].map(t=>`backups/2026-10-22/${t}.jsonl`),'backups/2026-10-22/manifest.json'].sort());
 const scans=lines(bucket.objects.get('backups/2026-10-22/scans.jsonl').body);
 assert.equal(scans.length,6,'pageSize 2 over 6 rows still exports every row once');
 assert.ok(scans.every(r=>!('_rowid' in r)),'cursor column is not written');
 assert.equal(JSON.parse(scans[0].result_json).account.username,'hkj315');
 const evidence=lines(bucket.objects.get('backups/2026-10-22/evidence.jsonl').body);
 assert.equal(evidence[0].text,'中文 "quoted" 內容\n換行','newlines stay escaped inside one line');
 assert.equal(bucket.objects.get('backups/2026-10-22/analysis_runs.jsonl').body,'','empty table still gets a file');
 assert.equal(bucket.objects.get('backups/2026-10-22/manifest.json').contentType,'application/json');
 assert.deepEqual(JSON.parse(bucket.objects.get('backups/2026-10-22/manifest.json').body).rows,manifest.rows);
 assert.deepEqual(lines(bucket.objects.get('backups/2026-10-22/pledges.jsonl').body).map(r=>r.token_hash).sort(),['hash-1','hash-2']);
});

test('pruneBackups keeps the last 30 days and drops older folders through paged listing',async()=>{
 const bucket=fakeBucket({pageLimit:2});
 for(const d of ['2026-09-21','2026-09-22','2026-09-23','2026-10-21','2026-10-22'])for(const f of ['scans.jsonl','evidence.jsonl','manifest.json','a.jsonl','b.jsonl'])bucket.objects.set(`backups/${d}/${f}`,{body:''});
 bucket.objects.set('backups/not-a-date/x',{body:''});bucket.objects.set('other/2026-01-01/x',{body:''});
 const deleted=await pruneBackups({bucket,now:()=>T0});
 // today (Taipei) is 10-22; cutoff is 09-22, so 09-21 goes and 09-22 stays.
 assert.deepEqual(deleted,['2026-09-21']);
 const keys=[...bucket.objects.keys()];
 assert.ok(!keys.some(k=>k.startsWith('backups/2026-09-21/')));
 assert.equal(keys.filter(k=>k.startsWith('backups/2026-09-22/')).length,5);
 assert.ok(keys.includes('backups/not-a-date/x')&&keys.includes('other/2026-01-01/x'));
 assert.equal(bucket.calls.filter(c=>c.startsWith('delete:')).length,5);
});

test('runBackup prunes after writing, and a rerun on the same day overwrites in place',async()=>{
 const core=dataObject(),bucket=fakeBucket();
 bucket.objects.set('backups/2026-01-01/manifest.json',{body:'{}'});
 const first=await runBackup({storeStub:core,bucket,now:()=>T0,keepDays:7});
 assert.deepEqual(first.deleted,['2026-01-01']);
 core.store.create('hkj315');
 const second=await runBackup({storeStub:core,bucket,now:()=>T0+60000,keepDays:7});
 assert.equal(second.rows.scans,1);
 assert.equal([...bucket.objects.keys()].filter(k=>k.startsWith('backups/2026-10-22/')).length,BACKUP_TABLES.size+1);
 await assert.rejects(runBackup({storeStub:core,bucket:undefined}),/BACKUPS bucket/);
});

test('POST /api/admin/backup runs the same export behind ADMIN_TOKEN',async()=>{
 const core=dataObject(),bucket=fakeBucket();core.store.create('hkj315');
 const backup=()=>runBackup({storeStub:core,bucket,now:()=>T0});
 const assets={fetch:async()=>new Response('')};
 const app=createWorkerApp({...ENV,ADMIN_TOKEN:'admin-fixture',ASSETS:assets},{storeStub:core,startScan:()=>{},backup});
 const req=(headers={},method='POST')=>new Request('https://whospost.example/api/admin/backup',{method,headers});
 assert.equal((await app(req())).status,401);
 assert.equal((await app(req({authorization:'Bearer admin-fixture'},'GET'))).status,404);
 const r=await app(req({authorization:'Bearer admin-fixture'}));
 assert.equal(r.status,200);
 const body=await r.json();
 assert.equal(body.date,'2026-10-22');assert.equal(body.rows.scans,1);
 assert.ok(bucket.objects.has('backups/2026-10-22/manifest.json'));
 const closed=createWorkerApp({...ENV,ASSETS:assets},{storeStub:core,startScan:()=>{},backup});
 assert.equal((await closed(req({authorization:'Bearer admin-fixture'}))).status,404,'no ADMIN_TOKEN, no route');
 const unbound=createWorkerApp({...ENV,ADMIN_TOKEN:'admin-fixture',ASSETS:assets},{storeStub:core,startScan:()=>{}});
 assert.equal((await unbound(req({authorization:'Bearer admin-fixture'}))).status,503);
});
