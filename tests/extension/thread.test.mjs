import test from 'node:test';
import assert from 'node:assert/strict';
import {contentKey,createThread,threadVerdict,firstReplies,NO_THREAD,SHORT_CHARS} from '../../extension/lib/thread.mjs';
import {norm} from '../../shared/signals.mjs';

test('content keys use the site\'s normalisation: NFKC + collapsed spaces; short text and greetings do not count',()=>{
 assert.equal(contentKey('這是　一段  留言內容！'),norm('這是 一段 留言內容！'));
 assert.equal(contentKey('這是　一段  留言內容！'),'這是 一段 留言內容!','NFKC folds the full-width mark too');
 assert.equal(contentKey('ＡＢＣ 測試一下'),'ABC 測試一下','full-width letters fold to ASCII');
 assert.equal(contentKey('讚讚'),null,'greeting words the site ignores');
 assert.equal(contentKey('加油！！'),null);
 assert.equal(contentKey('好棒喔！'),null,`${SHORT_CHARS} characters or fewer once punctuation is gone`);
 assert.equal(contentKey('好棒喔棒棒'),'好棒喔棒棒','five characters count');
 assert.equal(contentKey(''),null);assert.equal(contentKey(null),null);
});

test('one account\'s replies are counted per reply key, so a re-rendered or recycled node never counts twice',()=>{
 const t=createThread();
 assert.equal(t.add({username:'Bot_A',replyKey:'s1',text:'完全相同的留言內容一'}),true);
 assert.equal(t.add({username:'bot_a',replyKey:'s1',text:'完全相同的留言內容一'}),false,'same reply seen again');
 t.add({username:'bot_a',replyKey:'s2',text:'完全相同的留言內容一'});
 t.add({username:'bot_a',replyKey:'n3',text:'讚'});
 assert.deepEqual(t.observe('BOT_A'),{replies:3,sameContent:1},'three replies; only this account posted that text');
 assert.deepEqual(t.observe('nobody'),{replies:0,sameContent:0});
 assert.equal(t.authors,1);
});

test('the same text from three different accounts is seen by each of them; a node recycled to new text moves its vote',()=>{
 const t=createThread();
 for(const u of ['a1','a2','a3'])t.add({username:u,replyKey:`${u}-1`,text:'投給 3 號就對了，大家一起來'});
 t.add({username:'a4',replyKey:'a4-1',text:'完全不同的內容在這裡'});
 assert.equal(t.observe('a1').sameContent,3);assert.equal(t.observe('a3').sameContent,3);assert.equal(t.observe('a4').sameContent,1);
 t.add({username:'a3',replyKey:'a3-1',text:'我改口了，換一段話'});
 assert.equal(t.observe('a1').sameContent,2,'a3 no longer shares the text');
 assert.equal(t.observe('a3').sameContent,1);
 t.reset();
 assert.deepEqual(t.observe('a1'),{replies:0,sameContent:0});assert.equal(t.authors,0);
});

test('thread verdict at the decided thresholds: 4 replies nothing, 5 a bar, 10 fades; the same text from 3 accounts a bar',()=>{
 const th={enabled:true,barAt:5,fadeAt:10,sameContentAt:3};
 assert.equal(threadVerdict({replies:4,sameContent:2},th).level,'none');
 assert.deepEqual(threadVerdict({replies:5,sameContent:0},th),{level:'bar',reasons:[{rule:'replies',n:5}],replies:5,sameContent:0});
 assert.equal(threadVerdict({replies:10,sameContent:0},th).level,'fade');
 assert.deepEqual(threadVerdict({replies:1,sameContent:3},th).reasons,[{rule:'sameContent',n:3}]);
 assert.equal(threadVerdict({replies:1,sameContent:3},th).level,'bar','same content alone never fades');
 assert.deepEqual(threadVerdict({replies:12,sameContent:4},th).reasons,[{rule:'replies',n:12},{rule:'sameContent',n:4}]);
 assert.equal(threadVerdict({replies:12,sameContent:4},{...th,enabled:false}).level,'none','switched off in the popup');
 assert.equal(threadVerdict({replies:2,sameContent:2},{...th,barAt:2,sameContentAt:2}).level,'bar','thresholds are adjustable');
});

test('firstReplies: an account is marked once, on its first reply in page order; later ones draw nothing, whatever the count',()=>{
 assert.deepEqual(firstReplies([{username:'a'},{username:'b'},{username:'A'},{username:'a'},{username:'c'},{username:'b'}]),[true,true,false,false,true,false]);
 assert.deepEqual(firstReplies([]),[]);assert.deepEqual(firstReplies([{username:''},{}]),[false,false]);
 // Re-sorted page: the first reply is whichever comes first now, not the one marked before.
 assert.deepEqual(firstReplies([{username:'a',id:2},{username:'a',id:1}]),[true,false]);
 assert.deepEqual(threadVerdict(NO_THREAD,{enabled:true,barAt:5,fadeAt:10,sameContentAt:3}),{level:'none',reasons:[],replies:0,sameContent:0},'a non-first reply gets the empty verdict');
});
