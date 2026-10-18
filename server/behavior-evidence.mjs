// Descriptive evidence only. Helpers are injected to share the existing rules
// without circular imports or changes to the scoring denominator.
export function describeBehavior({posts,comments,commentsAvailable,allReplyCount},helpers){
 const {similarity,normalizeText,canonicalParent,verifiedOwnUrl,username}=helpers;
 const time=records=>{
  const timestamps=records.map(r=>Date.parse(r.postedAt)).filter(Number.isFinite).sort((a,b)=>a-b);
  const complete=timestamps.length===records.length;
  const span=timestamps.length?(timestamps.at(-1)-timestamps[0])/1000:null;
  return {status:complete?'available':timestamps.length?'partial':'unavailable',validCount:timestamps.length,missingCount:records.length-timestamps.length,knownStartAt:timestamps.length?new Date(timestamps[0]).toISOString():null,knownEndAt:timestamps.length?new Date(timestamps.at(-1)).toISOString():null,knownSpanSeconds:span,spanSeconds:complete?span:null};
 };
 const origins=rows=>{
  const seen=new Set(),valid=[];let invalidOriginCount=0,duplicateOriginUrls=0;
  for(const row of rows){
   if(!verifiedOwnUrl(row.url,username)){invalidOriginCount++;continue;}
   const key=canonicalParent(row.url,'');
   if(seen.has(key)){duplicateOriginUrls++;continue;}
   seen.add(key);valid.push(row);
  }
  return {valid,invalidOriginCount,duplicateOriginUrls};
 };
 const parent=row=>{
  const url=canonicalParent(row.parentUrl,username);if(!url)return null;
  const actual=new URL(url).pathname.split('/')[1].slice(1);
  if(row.parentAuthor&&String(row.parentAuthor).replace(/^@/,'').toLowerCase()!==actual)return null;
  return url;
 };
 const p=origins(posts),c=origins(comments);
 const original=p.valid.filter(r=>!r.isQuote&&!r.isRepost&&!r.isReply);
 const long=r=>normalizeText(r.text).length>=20;
 const exact=r=>String(r.text??'').normalize('NFKC').replace(/\s+/g,' ').trim();
 const comparable=original.filter(r=>long(r)||normalizeText(r.text).length>=8||/https?:\/\//.test(String(r.text??'')));
 const matches=(a,b)=>long(a)&&long(b)?similarity(a.text,b.text)>=.85:!long(a)&&!long(b)&&exact(a)===exact(b);
 const clusters=[];
 for(const record of comparable){const group=clusters.find(g=>g.every(other=>matches(record,other)));if(group)group.push(record);else clusters.push([record]);}
 const repeatGroups=clusters.filter(records=>records.length>=2).map(records=>({count:records.length,differentPostCount:records.length,knownParentCount:new Set(records.map(parent).filter(Boolean)).size,matchType:long(records[0])?'similar_long':'exact_short',nonScoring:true,time:time(records),records}));
 const parentGroups=new Map();let unknownParentCount=0;
 for(const record of c.valid){const key=parent(record);if(!key){unknownParentCount++;continue;}if(!parentGroups.has(key))parentGroups.set(key,[]);parentGroups.get(key).push(record);}
 const knownParentReplies=c.valid.length-unknownParentCount;
 const threadGroups=[...parentGroups].map(([parentUrl,records])=>({parentUrl,count:records.length,shareOfFetchedReplies:comments.length?records.length/comments.length:null,shareOfKnownParentReplies:knownParentReplies?records.length/knownParentReplies:null,nonScoring:true,time:time(records),records})).sort((a,b)=>b.count-a.count||a.parentUrl.localeCompare(b.parentUrl));
 const scope='fetched_sample_only';
 return {version:'behavior-evidence-v1',nonScoring:true,
  postRepetition:{status:comparable.length>=2?'available':'insufficient_data',summary:comparable.length>=2?`本次 ${posts.length} 筆本人貼文中，找到 ${repeatGroups.length} 組不同貼文的近似長文或相同短文；僅描述，不計分。`:'可比較的本人貼文不足兩篇，尚無法描述跨貼文重複。',groups:repeatGroups,coverage:{scope,completeness:'not_established',requested:10,fetched:posts.length,validOriginCount:p.valid.length,comparableCount:comparable.length,excludedQuoteOrRepost:p.valid.filter(r=>r.isQuote||r.isRepost).length,excludedReplyCount:p.valid.filter(r=>r.isReply).length,missingSourceCount:p.valid.filter(r=>!r.source||r.source==='unknown').length,invalidOriginCount:p.invalidOriginCount,duplicateOriginUrls:p.duplicateOriginUrls,missingTimestampCount:comparable.filter(r=>!Number.isFinite(Date.parse(r.postedAt))).length},limitations:['只描述已取回的最多十篇本人貼文，不代表完整歷史；近似與重複分享不能證明操作動機。']},
  threadConcentration:{status:!commentsAvailable?'unavailable':knownParentReplies?'available':'insufficient_data',grouping:'direct_parent_post',summary:`本次 ${comments.length} 則已展示本人留言中，${knownParentReplies} 則可辨識直接父貼文，共 ${parentGroups.size} 篇；留言集中程度不加入分數。`,differentParentCount:parentGroups.size,maxCommentsOnOneParent:threadGroups[0]?.count??null,groups:threadGroups,coverage:{scope,completeness:'not_established',requested:50,fetched:comments.length,receivedAuthoredReplies:allReplyCount,excludedBeforeDisplay:allReplyCount-comments.length,validOriginCount:c.valid.length,knownParentReplies,unknownParentCount,missingSourceCount:c.valid.filter(r=>!r.source||r.source==='unknown').length,invalidOriginCount:c.invalidOriginCount,duplicateOriginUrls:c.duplicateOriginUrls,missingTimestampCount:c.valid.filter(r=>!Number.isFinite(Date.parse(r.postedAt))).length},limitations:['只能按已取得的直接父貼文分組；缺少 root thread 資料，不能保證不同父貼文屬於不同討論串。','占比只以本人取回樣本計算，不是整串留言占比、留言速率或網軍機率；不同父文、缺父文與取樣上限都可能影響集中程度。']}
 };
}
