import test from 'node:test';
import assert from 'node:assert/strict';
import {analyze, normalizeText} from '../../server/analysis.mjs';
const text='這是一段足夠長的原創內容需要一起比較文字與時間才可以判斷協同行為';
const row=(id,extra={})=>({id,author:'target',kind:'post',text:text+id,postedAt:'2026-10-17T00:00:00Z',url:`https://www.threads.com/@target/post/${id}`,source:'provider',isQuote:false,isRepost:false,...extra});
const bundle=(extra={})=>({account:{username:'target'},posts:Array.from({length:5},(_,i)=>row(String(i))),comments:[],comparison:[],comparedTargetIds:[],commentsAvailable:false,vocabularyEntries:[{term:'視頻',sourceUrl:'https://invade.tw/vocabs'}],...extra});
test('missing comparison does not prevent self-only score and remains context only',()=>{const r=analyze(bundle());assert.equal(r.score.value,0);assert.equal(r.score.coordination,null);assert.equal(r.analysis.coordination.status,'context_only');});
test('observed synchronization across two other authors remains non-scoring evidence',()=>{const b=bundle();b.comparison=['a','b'].map(author=>row(author,{author,text:b.posts[0].text}));b.comparedTargetIds=b.posts.map(p=>p.id);const r=analyze(b);assert.equal(r.score.coordination,null);assert.equal(r.score.value,0);assert.ok(r.analysis.coordination.groups.length>0);});
test('received replies do not count as target behavior',()=>{const b=bundle({posts:[],comments:[row('x',{author:'other',kind:'authored_reply'})],commentsAvailable:true});assert.equal(analyze(b).coverage.comments.fetched,0);});
test('quote and short slogans excluded and vocabulary never creates points',()=>{const b=bundle({posts:Array.from({length:5},(_,i)=>row(String(i),{text:'視頻',isQuote:true}))});b.comparedTargetIds=b.posts.map(p=>p.id);const r=analyze(b);assert.equal(r.score.value,null);assert.equal(r.analysis.vocabulary.matches[0].count,5);});
test('cross-thread repetition requires target authored replies with distinct parents',()=>{const b=bundle({posts:[],comments:[row('a',{kind:'authored_reply',text,parentUrl:'https://www.threads.com/@a/post/1'}),row('b',{kind:'authored_reply',text,parentUrl:'https://www.threads.com/@b/post/2'})],commentsAvailable:true});const r=analyze(b);assert.equal(r.analysis.repetition.groups[0].crossThread,true);assert.equal(r.score.repetition,null);assert.equal(r.analysis.repetition.groups[0].nonScoring,true);});
test('empty normalized URLs cannot match',()=>assert.equal(normalizeText('https://example.com x'),'x'));
test('deduplicates same source before scoring',()=>{const b=bundle({posts:[row('x'),row('x')]});assert.equal(analyze(b).coverage.posts.fetched,1);});
test('short URL parent is not proof of another author',()=>{const b=bundle({comments:[row('r',{kind:'authored_reply',parentUrl:'https://www.threads.com/t/abc'})],commentsAvailable:true});assert.equal(analyze(b).comments.length,0);b.comments[0].parentAuthor='other';assert.equal(analyze(b).comments.length,1);});
test('empty searches do not claim coordination absence while own score is available',()=>{const b=bundle();b.comparedTargetIds=b.posts.map(r=>r.id);const r=analyze(b);assert.equal(r.score.value,0);assert.equal(r.score.scope,'observed-repetition');assert.equal(r.analysis.coordination.status,'context_only');});

test('same short comment with link across parents is evidence without adding score',()=>{
 const comments=['a','b'].map(id=>row(id,{kind:'authored_reply',text:'試試這個\nhttps://github.com/example/project',parentAuthor:id,parentUrl:`https://www.threads.com/@${id}/post/p`}));
 const r=analyze(bundle({posts:[],comments,commentsAvailable:true}));
 assert.equal(r.analysis.repetition.groups.length,1);assert.equal(r.analysis.repetition.groups[0].nonScoring,true);assert.equal(r.analysis.repetition.groups[0].crossThread,true);assert.equal(r.score.repetition,null);assert.equal(r.score.value,null);
 const simple=analyze(bundle({posts:[],comments:comments.map(r=>({...r,text:'讚'})),commentsAvailable:true}));assert.ok(simple.analysis.repetition.groups.every(g=>g.type==='common_short'&&g.nonScoring));assert.equal(simple.score.value,null);
});
