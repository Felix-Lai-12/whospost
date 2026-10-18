import test from 'node:test';
import assert from 'node:assert/strict';
import {analyze,RULE_VERSION} from '../../server/analysis.mjs';
import {readFileSync} from 'node:fs';
const text='這是提供大家參考的完整技術教學內容包含安裝方式與實際範例歡迎提出問題';
const post=(i,extra={})=>({id:String(i),author:'alice',kind:'post',text,url:`https://www.threads.com/@alice/post/${i}`,postedAt:`2026-10-17T0${i}:00:00Z`,source:'fixture',...extra});
const reply=(i,extra={})=>post(i,{kind:'authored_reply',parentUrl:'https://www.threads.com/@other/post/root',parentAuthor:'other',...extra});
const run=(posts=[],comments=[],extra={})=>analyze({account:{username:'alice'},posts,comments,commentsAvailable:true,...extra});
test('similar standalone posts show evidence and do not change score',()=>{
 const result=run([post(1),post(2),post(3,{text:'這是完全不同的生活紀錄今天到山上看夕陽並分享旅遊與食物的小心得'})]);
 const section=result.analysis.behavior.postRepetition;
 assert.equal(section.groups.length,1);assert.equal(section.groups[0].count,2);
 assert.equal(section.groups[0].differentPostCount,2);assert.equal(section.groups[0].time.spanSeconds,3600);
 assert.equal(section.groups[0].nonScoring,true);assert.equal(section.groups[0].records[0].url,post(1).url);
 assert.equal(result.score.value,null);assert.equal(result.score.version,RULE_VERSION);
});
test('quotes reposts and short thanks excluded, two exact short link shares remain descriptive',()=>{
 const result=run([post(1,{text:'謝謝'}),post(2,{text:'謝謝'}),post(3,{isQuote:true}),post(4,{isRepost:true}),post(5,{text:'試試這個 https://github.com/example/repo'}),post(6,{text:'試試這個 https://github.com/example/repo'})]);
 const section=result.analysis.behavior.postRepetition;
 assert.equal(section.groups.length,1);assert.equal(section.groups[0].matchType,'exact_short');
 assert.equal(section.coverage.excludedQuoteOrRepost,2);assert.equal(result.score.value,null);
});
test('repeated fetches and own URL aliases never inflate post or reply counts',()=>{
 const duplicate=post(2,{url:'https://threads.net/@ALICE/post/1/?x=1#top'});
 assert.equal(run([post(1),duplicate]).analysis.behavior.postRepetition.groups.length,0);
 const section=run([],[reply(1),reply(2,{url:'https://threads.net/@alice/post/1?x=1'})]).analysis.behavior.threadConcentration;
 assert.equal(section.groups[0].count,1);assert.equal(section.coverage.duplicateOriginUrls,1);
});
test('same canonical parent concentration counts both denominators without guessing root thread',()=>{
 const rows=[reply(1),reply(2,{parentUrl:'https://threads.net/@OTHER/post/root/?x=1#top'}),reply(3,{parentUrl:'https://www.threads.com/@another/post/else',parentAuthor:'another'}),reply(4,{parentUrl:null,parentAuthor:'other'})];
 const section=run([],rows).analysis.behavior.threadConcentration;
 assert.equal(section.grouping,'direct_parent_post');assert.equal(section.differentParentCount,2);
 assert.equal(section.groups[0].count,2);assert.equal(section.groups[0].shareOfFetchedReplies,.5);
 assert.equal(section.groups[0].shareOfKnownParentReplies,2/3);
 assert.equal(section.coverage.unknownParentCount,1);assert.equal(section.groups[0].nonScoring,true);
 assert.equal(section.groups[0].time.spanSeconds,3600);
});
test('missing timestamps remain unknown and do not become zero-duration bursts',()=>{
 const section=run([],[reply(1),reply(2,{postedAt:null}),reply(3,{postedAt:'bad'})]).analysis.behavior.threadConcentration;
 assert.equal(section.groups[0].time.status,'partial');assert.equal(section.groups[0].time.spanSeconds,null);
 assert.equal(section.groups[0].time.knownSpanSeconds,0);assert.equal(section.coverage.missingTimestampCount,2);
 const unknown=run([],[reply(1,{postedAt:null}),reply(2,{postedAt:null})]).analysis.behavior.threadConcentration.groups[0];
 assert.equal(unknown.time.status,'unavailable');assert.equal(unknown.time.knownSpanSeconds,null);
});
test('malformed or conflicting parents and invalid original URLs are disclosed rather than counted',()=>{
 const rows=[reply(1,{parentUrl:'https://example.com/@other/post/root'}),reply(2,{parentAuthor:'someone_else'}),reply(3,{url:'https://www.threads.com/@bob/post/3'}),reply(4,{parentUrl:null})];
 const section=run([],rows).analysis.behavior.threadConcentration;
 assert.equal(section.groups.length,0);assert.equal(section.coverage.invalidOriginCount,1);
 assert.equal(section.coverage.unknownParentCount,3);assert.equal(section.status,'insufficient_data');
});
test('empty or provider-unavailable coverage cannot claim no repeated behavior',()=>{
 assert.equal(run().analysis.behavior.postRepetition.status,'insufficient_data');
 assert.equal(run([],[],{commentsAvailable:false}).analysis.behavior.threadConcentration.status,'unavailable');
 assert.equal(run([], [reply(1)]).analysis.behavior.threadConcentration.coverage.scope,'fetched_sample_only');
});
test('descriptive counts leave existing v2.1 formula unchanged for qualifying repetition',()=>{
 const rows=Array.from({length:5},(_,i)=>reply(i+1,{parentUrl:`https://www.threads.com/@other/post/${i+1}`}));
 const result=run([],rows);assert.equal(result.score.value,80);assert.equal(result.score.version,'rules-v3.1-observed-repetition');
 assert.equal(result.analysis.behavior.threadConcentration.differentParentCount,5);
});

const savedComparison=JSON.parse(readFileSync(new URL('./fixtures/behavior-account-comparison.json',import.meta.url),'utf8'));
test('synthetic empty completed scan only validates insufficient data, never negative behavior',()=>{
 const saved=savedComparison.records.find(r=>r.bundle.account.username==='fixture_empty');
 assert.equal(saved.savedStatus,'completed');assert.equal(saved.label,null);
 assert.deepEqual(saved.sourceCounts,{posts:0,comments:0});
 const result=analyze(saved.bundle);
 assert.equal(result.score.value,null);assert.equal(result.score.version,'rules-v3.1-observed-repetition');
 assert.equal(result.analysis.behavior.postRepetition.status,'insufficient_data');
 assert.notEqual(result.analysis.behavior.threadConcentration.status,'available');
 assert.deepEqual(result.analysis.behavior.postRepetition.groups,[]);
 assert.deepEqual(result.analysis.behavior.threadConcentration.groups,[]);
 assert.doesNotMatch(result.score.reason,/安全|低風險|無可疑|正常帳號/);
});
test('synthetic populated scan validates observed counts and parents, not authenticity',()=>{
 const saved=savedComparison.records.find(r=>r.bundle.account.username==='fixture_account_1');
 assert.equal(saved.label,null);assert.deepEqual(saved.sourceCounts,{posts:9,comments:48});
 const result=analyze(saved.bundle);
 assert.equal(result.score.version,'rules-v3.1-observed-repetition');assert.equal(result.score.value,0);
 assert.equal(result.analysis.behavior.threadConcentration.differentParentCount,43);
 assert.equal(result.analysis.behavior.threadConcentration.groups[0].count,3);
 assert.equal(result.analysis.behavior.threadConcentration.groups[0].time.spanSeconds,1960);
 assert.equal(result.analysis.behavior.postRepetition.coverage.completeness,'not_established');
});
test('identical saved behavior under a different handle has the same score and descriptive counts',()=>{
 for(const saved of savedComparison.records){
  const original=saved.bundle,copy=structuredClone(original),name=original.account.username;
  copy.account.username='comparison_target';
  for(const row of [...copy.posts,...copy.comments]){
   if(row.author===name)row.author='comparison_target';
   if(row.url){const u=new URL(row.url);u.pathname=u.pathname.replace(`/@${name}/post/`,'/@comparison_target/post/');row.url=u.href;}
  }
  const a=analyze(original),b=analyze(copy);
  assert.deepEqual(a.score,b.score);
  assert.equal(a.analysis.behavior.postRepetition.groups.length,b.analysis.behavior.postRepetition.groups.length);
  assert.equal(a.analysis.behavior.threadConcentration.differentParentCount,b.analysis.behavior.threadConcentration.differentParentCount);
  assert.deepEqual(a.analysis.behavior.threadConcentration.groups.map(g=>g.count),b.analysis.behavior.threadConcentration.groups.map(g=>g.count));
 }
});
