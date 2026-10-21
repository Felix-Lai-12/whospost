import test from 'node:test';
import assert from 'node:assert/strict';
import {blobsFromHtml,parseBody,profilePosts,profileReplies,postReplies,hasNext,profileInfo,toRecord} from '../../server/providers/threads-embedded.mjs';
import {profileHtml,repliesHtml,repliesGraphql,postPageHtml,loginHtml,post} from './fixtures/threads-embedded.mjs';
test('embedded blobs: only those carrying thread data; a broken blob is skipped; the login wall has none',()=>{
 assert.equal(blobsFromHtml(profileHtml()).length,1);
 assert.equal(blobsFromHtml('<script type="application/json" data-sjs>{"mediaData":</script>').length,0);
 assert.equal(blobsFromHtml(loginHtml).length,0);
});
test('profile posts: owner only, first item of each thread, reposts and strangers skipped, deduplicated',()=>{
 const trees=blobsFromHtml(profileHtml('hkj315',10));
 const posts=profilePosts([...trees,...trees],'HKJ315');
 assert.equal(posts.length,10);
 assert.deepEqual(posts.map(p=>p.code),Array.from({length:10},(_,i)=>`own${i}`),'follow-ups in the owner\'s own thread are not posts');
 assert.equal(posts[0].url,'https://www.threads.com/@hkj315/post/own0');
 assert.equal(posts[0].postedAt,'2025-10-09T08:53:20.000Z');
 assert.equal(posts[1].replyCount,1);assert.equal(posts[0].isRepost,false);
 assert.equal(hasNext(trees,'mediaData'),true);
});
test('record flags: quote and repost come from share_info; text is kept whole; no author or code gives null',()=>{
 assert.equal(toRecord(post('q','hkj315',0,{text_post_app_info:{share_info:{quoted_post:{}}}})).isQuote,true);
 assert.equal(toRecord(post('r','hkj315',0,{text_post_app_info:{share_info:{reposted_post:{}}}})).isRepost,true);
 const long='很長的文字'.repeat(60);assert.equal(toRecord(post('l','hkj315',0,{caption:{text:long}})).text,long);
 assert.equal(toRecord({code:'x'}),null);assert.equal(toRecord({user:{username:'a'}}),null);
});
test('profile replies: the owner\'s reply after a parent by someone else, with the parent; own-thread replies skipped',()=>{
 const out=profileReplies(blobsFromHtml(repliesHtml('hkj315',4)),'hkj315');
 assert.deepEqual(out.map(r=>[r.code,r.parentAuthor]),[['reply0','hkj331155'],['reply1','user_b'],['reply2','hkj331155'],['reply3','user_b']]);
 assert.equal(out[0].parentUrl,'https://www.threads.com/@hkj331155/post/parent0');
});
test('a scrolled GraphQL body with the for(;;); prefix adds replies; ids stay unique across pages',()=>{
 const trees=[...blobsFromHtml(repliesHtml('hkj315',4)),parseBody(repliesGraphql('hkj315',7))];
 assert.equal(profileReplies(trees,'hkj315').length,11);
 assert.equal(hasNext(trees,'mediaData'),true,'the first page still says there is more');
 assert.equal(parseBody('<html>'),null);
});
test('post page: direct replies with their authors',()=>{
 const trees=blobsFromHtml(postPageHtml(3));
 assert.deepEqual(postReplies(trees).map(r=>r.author),['commenter_0','commenter_1','commenter_2']);
 assert.equal(hasNext(trees,'direct_replies'),true);
});
test('profile info: name, followers and privacy flag of the owner; null when the page has no user record',()=>{
 assert.deepEqual(profileInfo(blobsFromHtml(profileHtml('hkj315')),'hkj315'),{name:'測試帳號',followers:12,isPrivate:false});
 assert.equal(profileInfo(blobsFromHtml(postPageHtml()),'hkj315'),null);assert.deepEqual(profileInfo(blobsFromHtml(repliesHtml()),'hkj315'),{name:'測試帳號',followers:null,isPrivate:null},'a post author record gives the name only');
});
