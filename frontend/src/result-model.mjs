// Presentation adapters: never infer a score, a claim, or confirmed relevance.
export const hasScore=score=>typeof score?.value==='number'&&Number.isFinite(score.value);
export const groupRecords=group=>(group?.records||group?.evidence||[]).filter(r=>r&&typeof r==='object');
export function groupKind(group){const rows=groupRecords(group);if(group.type==='short_exact')return '完全相同的短文本';if(group.type==='short_template')return '短文本共同句型候選';if(group.type==='common_short')return '常見短語';if(group.crossThread===true)return rows.length>1&&rows.every(r=>typeof r.text==='string'&&r.text===rows[0].text)?'跨他人討論串的相同留言':'跨他人討論串的近似留言';if(rows.length&&rows.every(r=>r.kind==='post'))return '本人重複貼文';return '相似發言，討論串關係待確認'}
export function scoringLabel(group,score){if(group.nonScoring===true||group.scoring?.included===false)return '未計分';if(group.scoring?.included===true)return '已計入分數';if(!hasScore(score))return '尚未計分';return '納入重複規則比對'}
export function evidenceSummary(scan){
 const a=scan.analysis||{}, list=a.repetition?.groups;
 if(!hasScore(scan.score))return '目前資料不足以評分，先看看已取得的留言。';
 if(!Array.isArray(list))return '重複留言的證據尚未提供，暫時無法判斷。';
 const g=list.find(g=>g.type==='short_exact')||list.find(g=>g.crossThread===true)||list.find(g=>g.type==='short_template')||list.find(g=>g.type==='common_short')||list[0];
 let answer='這次未發現符合比對條件的重複內容。';
 if(g){const rows=groupRecords(g),kind=rows.length&&rows.every(r=>r.kind==='post')?'篇貼文':'則留言';
 answer=kind==='篇貼文'&&(g.type==='short_exact'||rows.every(r=>r.text===rows[0]?.text))?`發了 ${rows.length} 篇相同內容的貼文。`:g.type==='short_template'?`有 ${rows.length} ${kind}用了相似句型。`:g.type==='common_short'?`有 ${rows.length} ${kind}重複使用同一句簡短回應。`:`有 ${rows.length} ${kind}用了${g.type==='short_exact'||rows.every(r=>r.text===rows[0]?.text)?'相同':'相似'}內容。`;
 if(g.scoring?.included===false||g.nonScoring===true)answer+='本次未計分。';}
 const author=a.interactionConcentration?.authors?.[0];
 if(author)answer+=`最常回覆 @${author.author}，共 ${author.count} 則留言。`;
 return answer;
}
export function factClaims(fact={}){return Array.isArray(fact.claims)?fact.claims.map(c=>typeof c==='string'?{text:c}:c).filter(c=>c?.text):[]}
export function relevanceLabel(item){const status=typeof item.relevance==='string'?item.relevance:item.relevance?.status||item.relevanceStatus;return ({candidate:'文字候選，相關性待核對',rejected:'未通過相關性篩選',related:'與主張相關',relevant:'與主張相關',unrelated:'與主張無關',irrelevant:'與主張無關',uncertain:'相關性待確認',pending:'相關性待確認'})[status]||'相關性待確認'}

const textValue=value=>typeof value==='string'||typeof value==='number'?String(value):'';
export function scoreDetails(score={}){
 const explanation=score.explanation;const details=[];
 if(typeof explanation==='string'&&explanation.trim())details.push(explanation);
 else if(explanation&&typeof explanation==='object')for(const key of ['summary','description','formula'])if(textValue(explanation[key]))details.push(textValue(explanation[key]));
 if(score.version==='rules-v3.1-observed-repetition')details.push('至少 5 筆符合條件的原創文本才評分；共同句型、常見短語與互動對象集中均不加分。這些門檻尚未校準。長文近似門檻為 0.85，須在 24 小時內跨至少 3 個可核對的他人直接父貼文。');
 const raw=score.components??explanation?.components;
 const components=(Array.isArray(raw)?raw:raw&&typeof raw==='object'?Object.entries(raw).map(([key,value])=>typeof value==='object'&&value!==null?{key,...value}:{key,value}):[]).filter(c=>c&&typeof c==='object').map(c=>({label:textValue(c.label||c.name||c.key)||'評分項目',value:textValue(c.value),unit:textValue(c.unit),weight:textValue(c.weight),contribution:textValue(c.contribution),reason:c.label==='互動對象集中'?'按直接父貼文作者合計多個父文的留言，只描述分布，不計分。':textValue(c.reason),status:textValue(c.status)}));
 if(!details.length&&!components.length&&score.version==='rules-v1')details.push('目前公式：四捨五入（70 × 協同比例 C ＋ 30 × 重複比例 R）。',`C：${typeof score.coordination==='number'?score.coordination.toFixed(2):'資料不足'}；R：${typeof score.repetition==='number'?score.repetition.toFixed(2):'資料不足'}。`,'至少 5 筆本人原創長文本完成比對、涵蓋至少 2 個其他帳號，且兩項皆可計算才給分。');
 if(!details.length&&!components.length)details.push('此規則版本尚未提供計算說明，無法確認各項權重與分數來源。');
 return {details,components};
}
export function factEmptyMessage(fact={}){if(fact.reasonCode==='no_checkable_claim'||fact.status==='no_claim')return '本次文字沒有擷取到明確可查主張；這不代表內容已驗證為真。';return fact.status==='no_match'?'本次未找到相關候選，內容尚未獲得驗證。':fact.status==='error'?'查核服務暫時無法使用，請稍後再試。':'尚未取得查核結果。'}
export function verificationLabel(status){return ({not_checked:'尚未檢索',candidates_found:'找到候選，待核對',no_match:'未找到通過篩選的候選',error:'檢索失敗',irrelevant_candidate:'未通過相關性篩選',context_review_required:'需核對時空與語境',conflicting_responses:'回應看法分歧',responses_available:'有查核回應，待閱讀',unanswered:'尚無查核回應'})[status]||'驗證狀態待確認'}
export function claimEvidence(claim,items=[]){const all=[...(Array.isArray(claim.evidence)?claim.evidence:[]),...items.filter(i=>i.claimId&&i.claimId===claim.id)];return [...new Map(all.map((item,i)=>[item.id||item.url||`item-${i}`,item])).values()]}
export const responseTypeLabel=reply=>({RUMOR:'回應者認為含有不實資訊',NOT_RUMOR:'回應者認為不含不實資訊',OPINIONATED:'回應者認為屬個人觀點',NOT_ARTICLE:'回應者認為不屬適用的完整網傳訊息'})[reply.type]||reply.typeLabel||'未知回應類型';

export function groupReason(group){if(typeof group.scoring?.reason==='string'&&group.scoring.reason.trim())return group.scoring.reason;if(group.type==='short_template')return group.reason||'共同字序候選，須核對上下文，不計分。';if(group.type==='common_short')return group.reason||'一般寒暄或支持短語，只呈現頻次，不計分。';if(['short','short_text_or_link','short_comment'].includes(group.type))return '短句或連結重複，只保留作為閱讀線索。';if(group.nonScoring===true||group.scoring?.included===false)return '本次未計分，保留原文供核對。';return '相似文字需對照引用與上下文，不能單憑重複判定身分。'}
