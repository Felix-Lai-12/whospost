import test from 'node:test';import assert from 'node:assert/strict';import {Store} from '../../server/store.mjs';import {collectionProfile} from '../../server/collection-profile.mjs';
test('budget reservations idempotent and total limit enforced',()=>{const s=new Store(':memory:');s.budget.reserve('a',.6);s.budget.reserve('a',.6);assert.throws(()=>s.budget.reserve('b',.5),/預算/);s.budget.settle('a',.2);s.budget.settle('a',.2);assert.throws(()=>s.budget.reserve('b',.5),/預算/);s.budget.settle('a',.4);assert.equal(s.budget.summary().committed,.6);s.close();});
test('scans and provider state survive round trip and in-flight coalesces',()=>{const s=new Store(':memory:');const r=s.create('tester');s.setState(r.id,{jobs:{posts:{runId:'abc'}}});assert.equal(s.getState(r.id).jobs.posts.runId,'abc');assert.equal(s.findReusable('tester').id,r.id);s.close();});
test('global scan rate caps new scans even when the per-IP limit is evaded by spoofed IPs',()=>{const now=1700000000000;const s=new Store(':memory:',{budgetLimitUsd:100,dailyLimitUsd:100,globalScanRatePerMin:2,now:()=>now});const profile=collectionProfile('standard');const req=(user,ip)=>s.requestScan(user,profile,{configured:true,quota:{ip,max:3},estimateUsd:0});assert.equal(req('a','ip1').status,202);assert.equal(req('b','ip2').status,202);const third=req('c','ip3');assert.equal(third.status,429);assert.equal(third.body.code,'GLOBAL_RATE');s.close();});
test('global scan rate window resets the next minute',()=>{let now=1700000000000;const s=new Store(':memory:',{budgetLimitUsd:100,dailyLimitUsd:100,globalScanRatePerMin:1,now:()=>now});const profile=collectionProfile('standard');const req=user=>s.requestScan(user,profile,{configured:true,quota:{ip:'x',max:5},estimateUsd:0});assert.equal(req('a').status,202);assert.equal(req('b').body.code,'GLOBAL_RATE');now+=60000;assert.equal(req('c').status,202);s.close();});
test('global scan rate disabled when zero or unset lets scans through',()=>{const now=1700000000000;const s=new Store(':memory:',{budgetLimitUsd:100,dailyLimitUsd:100,globalScanRatePerMin:0,now:()=>now});const profile=collectionProfile('standard');const req=user=>s.requestScan(user,profile,{configured:true,quota:{ip:'x',max:99},estimateUsd:0});for(const u of ['a','b','c','d','e'])assert.equal(req(u).status,202);s.close();});
test('paused blocks a new scan but still serves a saved result',()=>{const s=new Store(':memory:');const profile=collectionProfile('standard');const first=s.requestScan('alice',profile,{paused:true});assert.equal(first.status,503);assert.equal(first.body.code,'SCANS_PAUSED');const started=s.requestScan('alice',profile,{});assert.equal(started.status,202);s.update(started.run,{status:'completed',posts:[{id:'p1',author:'alice',kind:'post',text:'x',postedAt:'2026-10-01T00:00:00Z'}]});const again=s.requestScan('alice',profile,{paused:true});assert.equal(again.status,200);assert.equal(again.body.cached,true);s.close();});
const failedSteps=code=>({status:'partial',profileId:'standard',steps:[{key:'posts',status:'failed',errorCode:code},{key:'replies',status:'failed',errorCode:code}]});
test('an empty completed result left by failed jobs is never served as the saved result; a clean empty one is',()=>{
 const s=new Store(':memory:');const profile=collectionProfile('standard');
 const empty=s.requestScan('hkj315',profile,{});s.update(empty.run,{status:'completed',posts:[],comments:[],collection:failedSteps('APIFY_HTTP')});
 assert.equal(s.findSaved('hkj315'),null);
 const clean=s.requestScan('hkj331155',profile,{});s.update(clean.run,{status:'completed',posts:[],comments:[],collection:{status:'available',profileId:'standard',steps:[{key:'posts',status:'succeeded',recordCount:0},{key:'replies',status:'succeeded',recordCount:0}]}});
 assert.equal(s.findSaved('hkj331155').id,clean.run,'an account that really has nothing stays cached');
 s.close();
});
test('failEmptyScans marks only empty completed scans whose jobs all failed, and the next request resumes them',()=>{
 let now=1700000000000;const s=new Store(':memory:',{now:()=>now});const profile=collectionProfile('standard');
 const empty=s.requestScan('hkj315',profile,{});s.update(empty.run,{status:'completed',posts:[],comments:[],collection:failedSteps('APIFY_HTTP')});
 const rows=s.requestScan('hkj331155',profile,{});s.update(rows.run,{status:'completed',posts:[{id:'p1',author:'hkj331155',kind:'post',text:'x',postedAt:'2026-10-01T00:00:00Z'}],comments:[],collection:{...failedSteps('APIFY_RUN_FAILED'),steps:[{key:'posts',status:'succeeded',recordCount:1},{key:'replies',status:'failed',errorCode:'APIFY_RUN_FAILED'}]}});
 const legacy=s.create('hkj300');s.update(legacy.id,{status:'completed',posts:[],comments:[]});
 now+=2*3600000;
 assert.deepEqual(s.failEmptyScans(),[empty.run]);
 const changed=s.get(empty.run);assert.equal(changed.status,'failed');assert.equal(changed.collection.status,'failed');
 assert.deepEqual(changed.error,{code:'PROVIDER_FAILED',message:'資料取得失敗，尚無法分析；失敗不等於 0 分。'},'APIFY_HTTP has no user message, so the generic one is used');
 assert.deepEqual(s.failEmptyScans(),[],'idempotent');
 assert.equal(s.get(rows.run).status,'completed');assert.equal(s.get(legacy.id).status,'completed','a scan without collection steps is left alone');
 const again=s.requestScan('hkj315',profile,{});assert.equal(again.status,202);assert.equal(again.run,empty.run);
 s.close();
});

test('the ledger totals kept by reserve and settle equal a full sum of the table, and an older database is seeded once',async()=>{
 const {mkdtempSync}=await import('node:fs'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
 const sum=s=>s.db.prepare('SELECT COALESCE(SUM(CASE WHEN final=1 THEN actual ELSE MAX(COALESCE(actual,0),reserved) END),0) committed,COALESCE(SUM(COALESCE(actual,0)),0) spent FROM budget').get();
 const file=join(mkdtempSync(join(tmpdir(),'whospost-budget-')),'store.db');
 const s=new Store(file,{budgetLimitUsd:100});
 s.budget.reserve('a:posts',.3);s.budget.reserve('a:replies',.08);s.budget.reserve('a:browser',.002);
 s.budget.settle('a:posts',.05);s.budget.settle('a:posts',.12,{final:true});s.budget.settle('a:replies',.2);s.budget.settle('a:browser',0,{final:true});
 s.budget.reserve('a:posts',.3);
 const full=sum(s),kept=s.budget.summary();
 assert.equal(kept.committed,Number(full.committed.toFixed(6)));assert.equal(kept.spent,Number(full.spent.toFixed(6)));
 assert.deepEqual([kept.committed,kept.spent],[.32,.32],'final rows count their bill, open ones the larger of bill and reservation');
 // A database from before the totals row existed: the first open sums the table once.
 s.db.exec('DROP TABLE budget_totals');s.close();
 const reopened=new Store(file,{budgetLimitUsd:100});
 assert.deepEqual([reopened.budget.summary().committed,reopened.budget.summary().spent],[.32,.32]);
 reopened.budget.reserve('b:replies',.08);assert.equal(reopened.budget.summary().committed,.4);
 reopened.close();
});

test('a 202 that admitted a new check says started; a check already running, or a stalled one started again, does not (STATUS P2-1)',()=>{
 let now=1700000000000;const s=new Store(':memory:',{budgetLimitUsd:100,dailyLimitUsd:100,now:()=>now});const profile=collectionProfile('standard');
 const req=()=>s.requestScan('alice',profile,{configured:true,quota:{ip:'x',max:10},estimateUsd:0});
 const first=req();assert.equal(first.status,202);assert.equal(first.body.started,true);
 s.update(first.run,{status:'running'});
 const again=req();assert.equal(again.status,202);assert.equal(again.body.id,first.body.id);assert.equal('started' in again.body,false,'pressed again while it runs');
 assert.equal(s.db.prepare('SELECT SUM(count) AS n FROM ip_quota').get().n,1,'the quota counted the first press only');
 s.update(first.run,{status:'failed'});
 const resumed=req();assert.equal(resumed.status,202);assert.equal(resumed.body.started,true,'a failed check resumed is admitted and counted again');
 assert.equal(s.db.prepare('SELECT SUM(count) AS n FROM ip_quota').get().n,2);
 s.close();
});
