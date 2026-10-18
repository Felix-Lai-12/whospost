import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../../server/store.mjs';
import {analyze} from '../../server/analysis.mjs';
import {normalizeAutomation,normalizeAuthoredReply,normalizeSupplementPost} from '../../server/providers/normalize.mjs';

const text='這是一段長度超過二十個字的原創留言用於測試跨串重複不應依錯誤來源網址計分';
const row=(id,extra={})=>({id:String(id),author:'alice',kind:'authored_reply',text,postedAt:'2026-10-17T01:00:00Z',url:`https://www.threads.com/@alice/post/${id}`,parentUrl:`https://www.threads.com/@other/post/${id}`,parentAuthor:'other',source:'saved-provider',...extra});
const bundle=rows=>({account:{username:'alice'},comments:rows,commentsAvailable:true});

test('old scan restores its own latest observation after canonical evidence is overwritten',()=>{
 const store=new Store(':memory:');
 try{
  const a=store.create('alice'),b=store.create('alice');
  const original=row(1,{text:'first',fetchedAt:'2026-10-17T02:00:00Z'});
  const latest=row(1,{text:'latest in A',fetchedAt:'2026-10-17T03:00:00Z'});
  store.saveEvidence(a.id,[original,latest]);
  // Late arrival of an older observation must not supersede its newer observed_at.
  store.saveEvidence(a.id,[row(1,{text:'older late arrival',fetchedAt:'2026-10-17T01:00:00Z'})]);
  store.saveEvidence(b.id,[row(1,{text:'changed in B',fetchedAt:'2026-10-17T04:00:00Z'})]);
  assert.equal(store.db.prepare('SELECT scan_id FROM evidence WHERE author=? AND id=?').get('alice','1').scan_id,b.id);
  assert.deepEqual(store.evidenceForScan(a.id),[latest]);
  assert.equal(store.evidenceForScan(b.id)[0].text,'changed in B');
  assert.equal(store.evidenceForScan(a.id)[0].parentAuthor,'other');
 }finally{store.close();}
});

test('snapshot deduplicates normalized author identity but preserves other authors with the same content id',()=>{
 const store=new Store(':memory:');
 try{
  const scan=store.create('alice');
  store.saveEvidence(scan.id,[row(1,{text:'old',fetchedAt:'2026-10-17T01:00:00Z'}),row(1,{author:'@ALICE',text:'latest',fetchedAt:'2026-10-17T02:00:00Z'}),row(1,{author:'bob',text:'other author',fetchedAt:'2026-10-17T03:00:00Z'})]);
  assert.deepEqual(store.evidenceForScan(scan.id).map(r=>r.text),['latest','other author']);
 }finally{store.close();}
});

test('equal observation times resolve to newest insertion and legacy fallback only applies without observations',()=>{
 const store=new Store(':memory:');
 try{
  const scan=store.create('alice');
  store.saveEvidence(scan.id,[row(1,{text:'one',fetchedAt:'2026-10-17T03:00:00Z'})]);
  store.saveEvidence(scan.id,[row(1,{text:'two',fetchedAt:'2026-10-17T03:00:00Z'})]);
  // Simulate a canonical-only legacy record alongside a newer snapshot: do not merge it.
  store.db.prepare('INSERT INTO evidence SELECT ?,author,kind,text,posted_at,url,parent_url,fetched_at,source,scan_id,is_quote,is_repost FROM evidence LIMIT 1').run('legacy');
  assert.equal(store.evidenceForScan(scan.id).length,1);
  assert.equal(store.evidenceForScan(scan.id)[0].text,'two');
  store.db.prepare('DELETE FROM observations WHERE scan_id=?').run(scan.id);
  assert.equal(store.evidenceForScan(scan.id).length,2);
  assert.deepEqual(store.evidenceForScan('absent'),[]);
 }finally{store.close();}
});

test('controlled normalizers reject external host but currently allow mismatched author and profile paths',()=>{
 const raw={type:'post',postId:'id',username:'alice',text,date:'2026-10-17T01:00:00Z'};
 assert.equal(normalizeAutomation({...raw,url:'https://example.com/@alice/post/id'}),null);
 assert.ok(normalizeAutomation({...raw,url:'https://www.threads.com/@bob/post/id'}));
 assert.ok(normalizeAuthoredReply({record_type:'reply',is_reply:true,id:'id',username:'alice',text,posted_at:raw.date,url:'https://www.threads.com/@bob/post/id'},'alice'));
 assert.ok(normalizeSupplementPost({record_type:'post',id:'id',username:'alice',text,posted_at:raw.date,url:'https://www.threads.com/@alice'},'alice'));
});

test('unverified origin URLs cannot contribute to numerator or denominator',()=>{
 const good=Array.from({length:5},(_,i)=>row(i+1));
 assert.equal(analyze(bundle(good)).score.value,80);
 const invalid=['https://example.com/@alice/post/1','https://www.threads.com/@bob/post/1','https://www.threads.com/@alice','https://www.threads.com:444/@alice/post/1','https://alice:pw@www.threads.com/@alice/post/1','https://www.threads.com/@alice/post/','http://www.threads.com/@alice/post/1','https://www.threads.com/@alice/post/1/more'];
 for(const url of invalid){
  assert.equal(analyze(bundle(good.map(r=>({...r,url})))).score.value,null,url);
  const result=analyze(bundle([...good,row(6,{url})]));
  assert.equal(result.score.value,80,url);
  assert.equal(result.score.components[0].value,4,url);
 }
});

test('Threads domain aliases and URL query or hash retain same-author valid origins',()=>{
 const urls=['https://threads.net/@ALICE/post/abc?x=1#top','https://www.threads.net/@alice/post/def/','https://threads.com/@alice/post/ghi','https://www.threads.com/@alice/post/jkl','https://www.threads.com:443/@alice/post/mno'];
 assert.equal(analyze(bundle(urls.map((url,i)=>row(i+1,{url})))).score.value,80);
});
