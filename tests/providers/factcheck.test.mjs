import test from 'node:test';
import assert from 'node:assert/strict';
import {extractClaims,assessRelevance} from '../../server/claims.mjs';
import {fetchFactChecks,REPLY_TYPE_LABELS} from '../../server/providers/cofacts.mjs';
import {analyze} from '../../server/analysis.mjs';
const text='政府宣布2026年10月17日台北發放補助，每人可領取1000元。';
const row=(s=text,id='p')=>({id,kind:'post',author:'target',text:s,url:`https://www.threads.com/@target/post/${id}`,postedAt:'2026-10-17T00:00:00Z'});
const reply=(type='RUMOR',status='NORMAL')=>({status:'NORMAL',reply:{id:type,text:'請核對原始公告及適用對象',type,status,reference:'來源 https://example.org/notice',createdAt:'2026-10-17T01:00:00Z'}});
const article=(s=text,extra={})=>({id:'article',text:s,status:'NORMAL',createdAt:'2026-10-17T00:00:00Z',articleReplies:[reply()],...extra});
const response=nodes=>new Response(JSON.stringify({data:{ListArticles:{edges:nodes.map(node=>({node}))}}}),{status:200});
const lookup=(rows,nodes)=>fetchFactChecks(rows,{fetchImpl:async()=>response(nodes)});

test('extraction preserves an exact span, full source and parent URL from a comment',()=>{
 const r={...row('我覺得這樣很好。\n  '+text,'r'),kind:'authored_reply',parentUrl:'https://www.threads.com/@other/post/parent'};
 const {claims}=extractClaims([r]);assert.equal(claims.length,1);const c=claims[0];
 assert.equal(c.text,text);assert.equal(c.source.text,r.text);assert.equal(c.source.url,r.url);assert.equal(c.source.parentUrl,r.parentUrl);
 assert.equal(r.text.slice(c.span.start,c.span.end),c.originalText);
});
test('opinion, satire, technical sharing, quote and slogans cannot become falsehood findings',async()=>{
 for(const r of [row('我覺得政府應該宣布補助1000元。'),row('政府宣布補助1000元，開玩笑啦。'),row('我開源的GitHub專案已經超過100個星星。'),{...row(),isQuote:true},row('台灣加油！')]){
  let calls=0;const result=await fetchFactChecks([r],{fetchImpl:async()=>{calls++;throw Error('must not call');}});
  assert.equal(result.status,'unavailable');assert.equal(result.reasonCode,'no_checkable_claim');assert.equal(calls,0);
 }
});
test('reported and questioned statements preserve stance and never imply endorsement',async()=>{
 for(const [sentence,stance] of [['聽說'+text,'reported'],[text.replace('。','是真的嗎？'),'question']]){
  const result=await lookup([row(sentence)],[article(sentence)]);
  assert.equal(result.claims[0].stance,stance);assert.equal(result.items[0].verificationStatus,'context_review_required');assert.equal(result.items[0].verdict,'undetermined');
 }
});
test('query is extracted factual sentence, not the whole original post',async()=>{
 let query;const r=row('我覺得這樣很好。\n'+text);
 const result=await fetchFactChecks([r],{fetchImpl:async(url,init)=>{query=JSON.parse(init.body);assert.equal(url,'https://api.cofacts.tw/graphql');return response([article()]);}});
 assert.equal(query.variables.like,text);assert.equal(result.items[0].sourceUrl,r.url);assert.equal(result.queryText,text);
});
test('related text yields candidates and correctly attributes response classification',async()=>{
 const result=await lookup([row()],[article()]);assert.equal(result.status,'available');
 const item=result.items[0];assert.equal(item.verificationStatus,'responses_available');assert.equal(item.verdict,'undetermined');
 assert.equal(item.replies[0].typeLabel,'回應者認為含有不實資訊');assert.equal(item.replies[0].sourcesVerified,false);
 assert.deepEqual(item.replies[0].sourceUrls,['https://example.org/notice']);assert.equal(result.license,'CC BY-SA 4.0');
 assert.match(result.attribution,/訊息回報機器人與查證協作社群/);assert.ok(item.replies[0].url.includes('/reply/'));
});
test('same vocabulary in a different proposition is rejected and retained for audit',async()=>{
 const result=await lookup([row()],[article('台北政府公布2026年死亡人口統計，民眾反映補助申請網站故障。')]);
 assert.equal(result.status,'no_match');assert.equal(result.items.length,0);assert.equal(result.claims[0].evidence[0].relevance.status,'rejected');
});
for(const [name,changed,reason] of [
 ['negation',text.replace('宣布','未宣布'),'negation_or_stance_difference'],
 ['old year',text.replace('2026','2018'),'different_explicit_year'],
 ['different date',text.replace('10月17日','10月18日'),'different_explicit_date'],
 ['different place',text.replace('台北','高雄'),'different_explicit_place'],
 ['different quantity',text.replace('1000元','2000元'),'different_explicit_quantity']]){
 test(name+' cannot inherit the candidate verdict',async()=>{
  const result=await lookup([row()],[article(changed)]);assert.equal(result.status,'no_match');
  assert.ok(result.claims[0].evidence[0].relevance.reasons.includes(reason));assert.equal(result.claims[0].verdict,'undetermined');
 });
}
test('relative date and old publication date demand context review even for identical text',async()=>{
 const r=row('政府今天宣布台北發放補助，每人可領取1000元。');
 const result=await lookup([r],[article(r.text,{createdAt:'2018-10-17T00:00:00Z'})]);
 assert.equal(result.items[0].verificationStatus,'context_review_required');
 assert.ok(result.items[0].relevance.contextWarnings.includes('publication_date_gap'));
});
test('a reported article without replies is unanswered, not false',async()=>{
 const result=await lookup([row()],[article(text,{articleReplies:[]})]);
 assert.equal(result.items[0].verificationStatus,'unanswered');assert.equal(result.items[0].verdict,'undetermined');
});
test('conflicting responses and all four enum types keep their original meaning',async()=>{
 const result=await lookup([row()],[article(text,{articleReplies:Object.keys(REPLY_TYPE_LABELS).map(type=>reply(type))})]);
 assert.equal(result.items[0].verificationStatus,'conflicting_responses');assert.equal(result.items[0].replies.length,4);
 assert.match(result.items[0].replies.find(r=>r.type==='NOT_ARTICLE').typeLabel,/完整網傳訊息/);
});
test('deleted, blocked, and unknown statuses are not usable evidence',async()=>{
 const result=await lookup([row()],[article(text,{status:'DELETED'}),article(text,{articleReplies:[reply('RUMOR','BLOCKED'),{...reply(),status:'DELETED'}, {...reply(),status:undefined}]})]);
 assert.equal(result.items.length,1);assert.equal(result.items[0].verificationStatus,'unanswered');
});
test('empty search is unknown and malformed response or transport failure is error',async()=>{
 assert.equal((await lookup([row()],[])).status,'no_match');
 for(const fetchImpl of [async()=>{throw Error('SECRET NEVER RETURN');},async()=>new Response('{}'),async()=>new Response('{"errors":[{}]}'),async()=>new Response('{}',{status:503})]){
  const result=await fetchFactChecks([row()],{fetchImpl});assert.equal(result.status,'error');assert.equal(result.claims[0].verificationStatus,'error');assert.ok(!JSON.stringify(result).includes('SECRET NEVER RETURN'));
 }
});
test('bounded claims preserve each result and partial service failure',async()=>{
 const rows=Array.from({length:5},(_,i)=>row(text.replace('1000',String(1000+i)),String(i)));
 let n=0;const result=await fetchFactChecks(rows,{maxClaims:99,fetchImpl:async()=>{if(++n===2)throw Error('network');return response([]);}});
 assert.equal(n,3);assert.equal(result.claims.length,3);assert.equal(result.extraction.eligibleCount,5);
 assert.equal(result.status,'error');assert.equal(result.failedClaimCount,1);assert.equal(result.partialFailure,true);assert.equal(result.claims[1].verificationStatus,'error');
});
test('fact-check evidence passes through analyze without changing account score',async()=>{
 const factChecks=await lookup([row()],[article()]);const b={account:{username:'target'},posts:[row()],comments:[]};
 const before=analyze(b),after=analyze({...b,factChecks});assert.deepEqual(after.score,before.score);assert.deepEqual(after.analysis.factChecks,factChecks);
});
test('the source is never mutated during extraction',()=>{const r=Object.freeze(row());assert.equal(extractClaims([r]).claims.length,1);});

// Second adversarial pass: actual failures observed in v1, not recall padding.
test('technical keyword does not swallow an independent public fact in the same sentence',()=>{
 const sentence='GitHub 更新說明：'+text;
 const result=extractClaims([row(sentence)]);
 assert.equal(result.claims.length,1);assert.equal(result.claims[0].originalText,sentence);
 assert.equal(extractClaims([row('在GitHub分享開源套件，已經超過100個星星。')]).claims.length,0);
});
test('satire and quotation scope do not erase or relabel the next independent sentence',()=>{
 const result=extractClaims([row('剛才開玩笑的。\n'+text)]);
 assert.equal(result.claims.length,1);assert.equal(result.claims[0].stance,'asserted');
 assert.ok(result.claims[0].extraction.contextWarnings.includes('satire_elsewhere_in_source'));
 const quoted=extractClaims([row('網傳「某個說法」。\n'+text)]);
 assert.equal(quoted.claims[0].stance,'asserted');
});
test('exact embedded quote followed by a denial cannot be an accepted candidate',async()=>{
 for(const suffix of ['是假的。','並不屬實，是不實訊息。','這是造謠。']){
  const result=await lookup([row()],[article('網傳「'+text+'」'+suffix)]);
  assert.equal(result.status,'no_match');assert.ok(result.claims[0].evidence[0].relevance.reasons.includes('negation_or_stance_difference'));
 }
});
test('two negatives with different targets do not cancel out in relevance comparison',()=>{
 const claim=extractClaims([row(text.replace('宣布','未宣布'))]).claims[0];
 const relevance=assessRelevance(claim,article(text.replace('發放','未發放')));
 assert.equal(relevance.status,'rejected');assert.ok(relevance.reasons.includes('negation_or_stance_difference'));
});
test('partial overlap in years places or quantities does not establish same proposition',async()=>{
 for(const suffix of ['2018年也有相同公告。','高雄另有同樣方案。','另一個方案每人可領取2000元。']){
  const result=await lookup([row()],[article(text+suffix)]);
  assert.equal(result.status,'no_match');assert.equal(result.claims[0].evidence[0].relevance.status,'rejected');
 }
});
test('opposed event predicate is rejected even when most wording overlaps',()=>{
 const claim=extractClaims([row('政府宣布2026年10月17日台北開放補助申請，每人可領取1000元。')]).claims[0];
 assert.equal(assessRelevance(claim,article(claim.text.replace('開放','關閉'))).status,'rejected');
});
test('article quotation and question are context warnings, not verified endorsements',async()=>{
 const result=await lookup([row()],[article('網傳「'+text+'」是真的嗎？')]);
 assert.equal(result.items[0].verificationStatus,'context_review_required');
 assert.ok(result.items[0].relevance.contextWarnings.includes('candidate_quotation_or_question_requires_review'));
});
test('original source query and fragment remain complete and reference punctuation is parsed safely',async()=>{
 const source={...row(),url:'https://www.threads.com/@fixture/post/p?x=1&y=2#原文'};
 const a=article();a.articleReplies[0].reply.reference='公告 https://example.org/notice?x=1&y=2。';
 const result=await lookup([source],[a]);
 assert.equal(result.claims[0].source.url,source.url);assert.equal(result.items[0].sourceUrl,source.url);
 assert.equal(result.items[0].replies[0].reference,a.articleReplies[0].reply.reference);
 assert.deepEqual(result.items[0].replies[0].sourceUrls,['https://example.org/notice?x=1&y=2']);
});
test('direct 不 negation of factual predicate rejects high-overlap candidates',async()=>{
 for(const changed of [text.replace('發放','不發放'),text.replace('發放','取消'),text.replace('領取','不得領取')]){
  const result=await lookup([row()],[article(changed)]);assert.equal(result.status,'no_match');
 }
});
test('identical mixed-predicate original is not rejected solely for mentioning both predicates',()=>{
 const original='政府宣布2026年10月17日台北開放補助申請，其他地區關閉申請。';
 const claim=extractClaims([row(original)]).claims[0];assert.equal(assessRelevance(claim,article(original)).status,'candidate');
});
