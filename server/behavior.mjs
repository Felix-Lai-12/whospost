export const BEHAVIOR_VERSION='rules-v3.1-observed-repetition';
const name=value=>String(value??'').replace(/^@/,'').toLowerCase();
const text=value=>String(value??'').normalize('NFKC').toLowerCase().replace(/https?:\/\/\S+/g,'').replace(/[\p{P}\p{S}\s]/gu,'');
const common=value=>/^(?:讚|棒|加油|辛苦了|早安|晚安|生日快樂|恭喜|謝謝分享|感謝分享|歡迎|您好|謝謝|感謝|哈哈|呵呵|ㄎ|ㄘ|支持)+$/u.test(value);
const original=row=>!row.isQuote&&!row.isRepost;
export function canonicalEvidenceUrl(value,username=null){
 try{const u=new URL(value),m=u.pathname.match(/^\/@([a-zA-Z0-9_.]+)\/post\/([a-zA-Z0-9_-]+)\/?$/);
 if(u.protocol!=='https:'||u.port||u.username||u.password||!['threads.com','www.threads.com','threads.net','www.threads.net'].includes(u.hostname)||!m||(username!==null&&name(m[1])!==name(username)))return null;
 return `https://www.threads.com/@${name(m[1])}/post/${m[2]}`;
 }catch{return null;}
}
function source(row,username){return row.id!=null&&String(row.id).trim()!==''&&!!canonicalEvidenceUrl(row.url,username)&&row.source&&row.source!=='unknown'&&Number.isFinite(Date.parse(row.postedAt));}
function parent(row,username){const url=canonicalEvidenceUrl(row.parentUrl);if(!url)return null;const author=new URL(url).pathname.split('/')[1].slice(1);return author!==username&&(!row.parentAuthor||name(row.parentAuthor)===author)?{author,url}:null;}
const range=rows=>{const dates=rows.map(r=>r.postedAt).filter(x=>Number.isFinite(Date.parse(x))).sort((a,b)=>Date.parse(a)-Date.parse(b));return {from:dates[0]??null,to:dates.at(-1)??null};};
const unique=rows=>{const ids=new Set(),urls=new Set();return rows.filter(r=>{const id=`${name(r.author)}:${r.id??r.url}`,url=canonicalEvidenceUrl(r.url,name(r.author));if(ids.has(id)||(url&&urls.has(url)))return false;ids.add(id);if(url)urls.add(url);return true;});};
// LCS is a bounded, literal template hint, never semantic equivalence or a score.
function commonSequence(a,b){let prev=Array(b.length+1).fill('');for(const ca of a){const next=[''];for(let j=1;j<=b.length;j++)next[j]=ca===b[j-1]?prev[j-1]+ca:prev[j].length>=next[j-1].length?prev[j]:next[j-1];prev=next;}return prev[b.length];}
export function analyzeBehavior({username,posts=[],comments=[],allReplies=comments,longGroups=[]}){
 username=name(username);
 const rows=unique([...posts,...comments]).filter(r=>name(r.author)===username&&original(r)&&source(r,username));
 const eligible=rows.filter(r=>text(r.text).length>=8&&!common(text(r.text))&&(r.kind==='post'||text(r.text).length>=20||parent(r,username)));
 const exact=new Map();for(const r of rows.filter(r=>text(r.text).length>=2&&!common(text(r.text)))){const key=String(r.text??'').normalize('NFKC').replace(/\s+/g,' ').trim();if(!exact.has(key))exact.set(key,[]);exact.get(key).push(r);}
 const shortGroups=[...exact.values()].filter(g=>g.length>1&&text(g[0].text).length<20).map(records=>{
   let best=[];
   for(const start of records){const window=records.filter(r=>Date.parse(r.postedAt)>=Date.parse(start.postedAt)&&Date.parse(r.postedAt)-Date.parse(start.postedAt)<=86400000);
    const postRows=window.filter(r=>r.kind==='post');const replyRows=window.filter(r=>r.kind==='authored_reply');
    const candidates=postRows.length>=2?postRows:[];
    const accepted=new Set(replyRows.map(r=>parent(r,username)?.url).filter(Boolean)).size>=3?replyRows:[];
    const group=text(records[0].text).length>=8?[...candidates,...accepted]:[];if(group.length>best.length)best=group;
   }
   return {type:'short_exact',records,crossThread:new Set(records.map(r=>parent(r,username)?.url).filter(Boolean)).size>1,nonScoring:best.length<2,scoring:{included:best.length>=2,recordIds:best.map(r=>r.id),reason:best.length>=2?'24小時內重複原創短句：至少兩篇貼文或三個他人串':text(records[0].text).length<8?'短於8字，僅呈現重複證據，不計分':'未達24小時內兩篇貼文或三個他人串'},observedRange:range(records)};
 });
 const scoringGroups=[...longGroups,...shortGroups];
 const included=new Set(eligible.map(r=>r.id));
 const counted=new Set();let extra=0;
 for(const group of scoringGroups){
  if(!group.scoring?.included)continue;
  const members=group.records.filter(r=>group.scoring.recordIds.includes(r.id)&&included.has(r.id)&&source(r,username));
  if(!group.type&&new Set(members.map(r=>parent(r,username)?.url).filter(Boolean)).size<3){group.nonScoring=true;group.scoring.included=false;group.scoring.recordIds=[];group.scoring.reason='不同原文URL、父串網址或作者資訊不足或不一致';continue;}
  const ids=[...new Set(members.map(r=>r.id))].filter(id=>!counted.has(id));
  if(ids.length>=2){extra+=ids.length-1;ids.forEach(id=>counted.add(id));group.scoring.recordIds=members.map(r=>r.id);}
 }
 const ready=eligible.length>=5;
 if(!ready)for(const g of scoringGroups){g.nonScoring=true;g.scoring.included=false;g.scoring.recordIds=[];g.scoring.reason='可核對且非一般寒暄的原創文本未達五筆；仍呈現重複證據';}
 const value=ready?Math.round(100*extra/eligible.length):null;
 const shortPosts=eligible.filter(r=>r.kind==='post'&&text(r.text).length<20);
 const templates=[];
 for(const r of shortPosts){const normalized=text(r.text);const g=templates.find(g=>g.records.every(other=>{const b=text(other.text),shared=commonSequence(normalized,b);return shared.length>=5&&shared.length/Math.max(normalized.length,b.length)>=.5;}));if(g)g.records.push(r);else templates.push({records:[r]});}
 const templateGroups=templates.filter(g=>g.records.length>=3).map(g=>({...g,type:'short_template',nonScoring:true,sharedCharacters:g.records.map(r=>text(r.text)).reduce(commonSequence),observedRange:range(g.records),reason:'字面共同字序候選；可能是一般標語、活動或引用，須閱讀完整原文，不重複加分'}));
 const replies=unique(allReplies.filter(r=>name(r.author)===username&&r.kind==='authored_reply'));
 const known=replies.map(record=>({record,parent:parent(record,username)})).filter(x=>x.parent&&canonicalEvidenceUrl(x.record.url,username));
 const groups=new Map();for(const x of known){if(!groups.has(x.parent.author))groups.set(x.parent.author,[]);groups.get(x.parent.author).push(x);}
 const authors=[...groups].map(([author,x])=>({author,count:x.length,distinctThreads:new Set(x.map(v=>v.parent.url)).size,records:x.map(v=>v.record)})).sort((a,b)=>b.count-a.count||a.author.localeCompare(b.author));
 const dominant=authors[0]??null;
 const ownThreadReplies=replies.filter(r=>{const u=canonicalEvidenceUrl(r.parentUrl);return u&&new URL(u).pathname.split('/')[1].slice(1)===username;}).length;
 const concentration={status:known.length>=5?'available':known.length?'partial':'unavailable',receivedAuthoredReplies:allReplies.length,totalObservedReplies:replies.length,duplicateOriginUrls:allReplies.length-replies.length,missingSourceCount:replies.filter(r=>!r.source||r.source==='unknown').length,missingTimestampCount:replies.filter(r=>!Number.isFinite(Date.parse(r.postedAt))).length,knownParentReplies:known.length,unknownParentReplies:replies.length-known.length-ownThreadReplies,excludedOwnThreadReplies:ownThreadReplies,excludedOrUnverifiedReplies:replies.length-known.length,dominantAuthor:dominant?.author??null,dominantCount:dominant?.count??0,share:known.length?dominant.count/known.length:null,minimumObservedShare:replies.length?(dominant?.count??0)/replies.length:null,authors,observedRange:range(known.map(x=>x.record)),scoreContribution:0,reason:'只描述本次可核對樣本的互動分布；粉絲、朋友、客服或活動互動也可能集中，未有同平台基準，不能據此判定異常或共同控制'};
 const commonGroups=[...Map.groupBy(rows.filter(r=>r.kind==='authored_reply'&&common(text(r.text))),r=>text(r.text))].filter(([,rs])=>rs.length>1).map(([normalized,records])=>({type:'common_short',normalized,records,nonScoring:true,reason:'一般寒暄或支持短語；僅呈現頻次，不加分'}));
 return {score:{value,version:BEHAVIOR_VERSION,scope:'observed-repetition',reason:ready?'已評估本人重複行為；分數不是網軍機率。':'可核對原創文本未達五筆；仍可查看短句與互動分布。',coordination:null,repetition:ready?extra/eligible.length:null,explanation:'100 × 合格重複群額外筆數 ÷ 可核對且至少8字的原創文本數；排除一般寒暄。短句須完全相同，24小時內至少兩篇貼文或三個他人串；長文沿用原有規則。句型、互動集中、詞彙與查核僅作脈絡，不加分。門檻未校準，0分不表示安全。',components:[{label:'本人重複行為',status:ready?'available':'unavailable',value:ready?extra:null,unit:'額外筆',contribution:value,reason:`可核對原創文本${eligible.length}筆`},{label:'互動對象集中',status:concentration.status,contribution:0,reason:known.length?`${dominant.count}/${known.length}則可核對留言在@${dominant.author}的串下`:'缺少可核對父串'},{label:'句型、協同、詞彙與查核',status:'context_only',contribution:0,reason:'僅作可閱讀證據，沒有已驗證的計分效度'}]},shortGroups,templateGroups,commonGroups,concentration,assessment:{status:ready||known.length>=5||shortGroups.length||templateGroups.length?'available':rows.length?'partial':'unavailable',summary:`已分析${posts.length}篇貼文、${known.length}/${replies.length}則具父串脈絡的留言；短句重複${shortGroups.length}組、共同句型${templateGroups.length}組。`,eligibleOriginalTexts:eligible.length,eligibleRecordIds:eligible.map(r=>r.id),observedRange:range(rows),signals:{shortRepetition:shortGroups.length,templateRepetition:templateGroups.length,interactionConcentration:concentration.share},conclusion:'可核對的重複與互動分布是行為觀察，尚不能證明協同、受雇或幕後組織。'}};
}
