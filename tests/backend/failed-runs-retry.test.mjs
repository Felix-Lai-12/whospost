import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../../server/store.mjs';
import {runScan} from '../../server/scan-runner.mjs';
import {fetchAccount} from '../../server/providers/index.mjs';
import {collectionProfile} from '../../server/collection-profile.mjs';
const json=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
const profile=collectionProfile('standard-25');
// Fake Apify: every run starts, then ends with `outcome()`; rows come from the dataset. Cofacts is unreachable.
function apify(outcome){
 const calls={dispatches:0};
 const fetchImpl=async url=>{
  if(url.includes('/runs?')){calls.dispatches++;return json({data:{id:`run${calls.dispatches}`,status:'READY',defaultDatasetId:`ds${calls.dispatches}`}});}
  const run=url.match(/actor-runs\/(run\d+)/)?.[1];
  if(run)return json({data:{id:run,status:outcome(run),defaultDatasetId:`ds${run.slice(3)}`}});
  if(url.includes('/datasets/'))return json([{record_type:'post',id:'1',username:'alice',text:'一篇公開發文',posted_at:'2026-10-01T00:00:00Z',url:'https://www.threads.com/@alice/post/1'}]);
  throw Error('offline');
 };
 return {calls,fetchAccount:(u,o)=>fetchAccount(u,{...o,token:'t',fetchImpl,waitSecs:0})};
}
test('when every Apify job fails the scan fails instead of being cached as an empty completed result',async t=>{
 const store=new Store(':memory:');t.after(()=>store.close());const a=apify(()=>'TIMED-OUT');
 const first=store.requestScan('alice',profile,{});
 assert.deepEqual(await runScan(first.run,{store,fetchAccount:a.fetchAccount}),{status:'failed',code:'PROVIDER_FAILED',cause:'PROVIDER_FAILED'});
 const scan=store.get(first.run);assert.equal(scan.collection.status,'failed');assert.deepEqual(scan.collection.steps.map(s=>s.errorCode),['APIFY_RUN_FAILED','APIFY_RUN_FAILED']);
 const again=store.requestScan('alice',profile,{});assert.equal(again.status,202);assert.equal(again.body.cached,false);assert.equal(again.run,first.run);
});
test('asking again dispatches new runs for failed ones, under new budget keys, and keeps the old runs for settlement',async t=>{
 const store=new Store(':memory:');t.after(()=>store.close());let failing=true;const a=apify(()=>failing?'FAILED':'SUCCEEDED');
 const first=store.requestScan('alice',profile,{});await runScan(first.run,{store,fetchAccount:a.fetchAccount});assert.equal(a.calls.dispatches,2);
 // A resumed run that nobody asked for reads the saved failures again and starts nothing new.
 assert.equal((await runScan(first.run,{store,fetchAccount:a.fetchAccount})).status,'failed');assert.equal(a.calls.dispatches,2);
 failing=false;store.requestScan('alice',profile,{});
 assert.equal((await runScan(first.run,{store,fetchAccount:a.fetchAccount})).status,'completed');assert.equal(a.calls.dispatches,4);
 const {jobs,releases}=store.getState(first.run);
 assert.deepEqual(Object.keys(jobs).sort(),['posts','posts:failed0','replies','replies:failed0']);
 assert.deepEqual(releases,{posts:1,replies:1});
 assert.equal(jobs.posts.reservedKey,`${first.run}:posts:retry1`);assert.equal(jobs['posts:failed0'].reservedKey,`${first.run}:posts`);assert.equal(jobs['posts:failed0'].status,'FAILED');
 assert.equal(store.get(first.run).posts.length,1);
});
test('a partial result with rows is still completed and cached',async t=>{
 const store=new Store(':memory:');t.after(()=>store.close());const a=apify(run=>run==='run1'?'SUCCEEDED':'FAILED');
 const first=store.requestScan('alice',profile,{});assert.equal((await runScan(first.run,{store,fetchAccount:a.fetchAccount})).status,'completed');
 assert.equal(store.get(first.run).collection.status,'partial');assert.equal(store.requestScan('alice',profile,{}).body.cached,true);
});
