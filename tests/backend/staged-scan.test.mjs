import test from 'node:test';import assert from 'node:assert/strict';
import {Store} from '../../server/store.mjs';
import {runScan} from '../../server/scan-runner.mjs';
const username='staged_user';
const post=id=>({id,author:username,kind:'post',text:`模擬測試貼文 ${id}，只用來驗證分段顯示。`,postedAt:'2026-10-17T01:00:00Z',url:`https://www.threads.com/@${username}/post/${id}`,parentUrl:null});
const reply=id=>({...post(id),kind:'authored_reply',parentAuthor:'someone_else',parentUrl:'https://www.threads.com/@someone_else/post/parent'});
const bundle=(posts,comments)=>({account:{username,url:`https://www.threads.com/@${username}`,name:'Fixture'},posts,comments,comparison:[],comparedTargetIds:[],commentsAvailable:true,limitations:[]});
const tick=()=>new Promise(r=>setTimeout(r,0));
function gate(){let open;const p=new Promise(r=>{open=r;});return {wait:()=>p,open};}

test('a running scan shows posts, then replies, and only the completed scan carries analysis and a score',async()=>{
 const store=new Store(':memory:'),{id}=store.create(username),postsDone=gate(),repliesDone=gate(),finish=gate();
 const posts=[post('p1'),post('p2')],comments=[reply('c1')];
 const done=runScan(id,{store,fetchAccount:async(_,{onPartial})=>{
  onPartial({account:{name:'Fixture'},posts});postsDone.open();await repliesDone.wait();
  onPartial({comments});finish.open();await tick();await tick();return bundle(posts,comments);
 }});
 await postsDone.wait();await tick();
 let view=store.scanView(id);
 assert.equal(view.status,'running');
 assert.deepEqual(view.partial.posts.map(p=>p.id),['p1','p2']);assert.equal(view.partial.comments,undefined,'replies not arrived yet');
 assert.equal(view.partial.account.name,'Fixture');
 assert.deepEqual(view.posts,[],'final fields stay empty while running');assert.equal(view.score.value,null);assert.equal(view.analysis.repetition.status,'unavailable');
 repliesDone.open();await finish.wait();await tick();
 view=store.scanView(id);
 assert.equal(view.status,'running');assert.deepEqual(view.partial.comments.map(r=>r.id),['c1']);assert.equal(view.partial.posts.length,2,'posts kept');
 assert.deepEqual(await done,{status:'completed'});
 view=store.scanView(id);
 assert.equal(view.status,'completed');assert.equal(view.partial,null);assert.equal(view.posts.length,2);assert.equal(view.comments.length,1);assert.ok(view.completedAt);assert.equal(typeof view.score.version,'string');
 store.close();
});

test('a scan waiting on Apify keeps its partial data, and the resumed run builds on it',async()=>{
 const store=new Store(':memory:'),{id}=store.create(username);
 const pending=await runScan(id,{store,resumable:true,fetchAccount:async(_,{onPartial})=>{onPartial({comments:[reply('c1')]});throw Object.assign(Error('pending'),{code:'APIFY_PENDING'});}});
 assert.equal(pending.status,'pending');
 assert.equal(store.get(id).status,'running');assert.equal(store.get(id).partial.comments.length,1);
 const seen=gate();
 const done=runScan(id,{store,resumable:true,fetchAccount:async(_,{onPartial})=>{onPartial({posts:[post('p1')]});seen.open();await tick();await tick();return bundle([post('p1')],[reply('c1')]);}});
 await seen.wait();await tick();
 const mid=store.get(id).partial;
 assert.equal(mid.posts.length,1);assert.equal(mid.comments.length,1,'replies from the earlier alarm are not dropped');
 await done;assert.equal(store.get(id).partial,null);
 store.close();
});

test('a failed scan drops its partial data',async()=>{
 const store=new Store(':memory:'),{id}=store.create(username);
 const result=await runScan(id,{store,fetchAccount:async(_,{onPartial})=>{onPartial({posts:[post('p1')]});throw Object.assign(Error('boom'),{code:'PROVIDER_FAILED'});}});
 assert.equal(result.status,'failed');
 const view=store.scanView(id);assert.equal(view.status,'failed');assert.equal(view.partial,null);
 store.close();
});
