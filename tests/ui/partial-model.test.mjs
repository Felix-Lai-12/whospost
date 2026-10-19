import test from 'node:test';import assert from 'node:assert/strict';
import {partialView,partialSummary,partialText} from '../../frontend/src/partial-model.mjs';
const account={username:'tester',url:'https://www.threads.com/@tester',name:null};
const running=partial=>({id:'x',status:'running',account,posts:[],comments:[],partial});

test('a running scan without data shows both parts as loading, not as empty',()=>{
 const v=partialView(running(undefined));
 assert.equal(v.posts,null);assert.equal(v.comments,null);
 assert.equal(v.summary,'正在讀取發文與留言…');
 assert.ok(!/0 篇|0 則|沒有/.test(v.summary));
});
test('posts arrive first: replies stay loading',()=>{
 const v=partialView(running({posts:[{id:'p1'},{id:'p2'}],account:{name:'Fixture'}}));
 assert.equal(v.posts.length,2);assert.equal(v.comments,null);assert.equal(v.account.name,'Fixture');
 assert.equal(v.summary,`已取得 2 篇貼文，${partialText.commentsLoading}`);
});
test('replies can arrive before posts',()=>{
 assert.equal(partialSummary(null,[{id:'c1'}]),`已取得 1 則留言，${partialText.postsLoading}`);
});
test('both arrived: still analysing, no verdict words',()=>{
 const s=partialSummary([{id:'p'}],[]);
 assert.equal(s,'已取得 1 篇貼文、0 則留言，正在分析…');
});
test('empty results say data is missing, never low risk or nothing suspicious',()=>{
 for(const text of [partialText.postsEmpty,partialText.commentsEmpty]){assert.match(text,/缺少資料不代表低風險/);assert.doesNotMatch(text,/低風險。$|查無可疑|沒有可疑|正常/);}
});
test('completed, failed and unknown scans have no partial view',()=>{
 for(const status of ['completed','failed'])assert.equal(partialView({...running({posts:[]}),status}),null);
 assert.equal(partialView(null),null);assert.equal(partialView({status:'running'}),null);
});
test('malformed partial data is treated as not arrived',()=>{
 const v=partialView(running({posts:'oops',comments:{}}));assert.equal(v.posts,null);assert.equal(v.comments,null);
});
