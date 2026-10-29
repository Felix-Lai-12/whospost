// Offline evidence packet. Does not consume scores, API keys, or network services.
export const behaviorResearch = [
 {id:'behavioral-traces',url:'https://arxiv.org/html/2001.05658v2',platform:'Twitter',basis:'Pacheco et al., ICWSM 2021；已核對 Introduction、Methods',observation:'研究以內容、活動時間及名稱等行為痕跡分析多帳號關係，並建議人工檢視內容與情境。',application:'本產品借用多面向痕跡與情境複核的方法，形成單帳號行為假說。',limit:'論文不是單帳號 Threads 判別器；共享熱門內容可能誤判，行為協同也不等於自動化或惡意。不能引用它確認本案協同或替固定門檻背書。'},
 {id:'amplification',url:'https://blog.x.com/en_us/topics/company/2020/information-operations-june-2020',platform:'Twitter',basis:'平台調查公告；不是 Threads 分類論文',observation:'平台調查區分原始訊息與放大活動，互動關係可協助觀察傳播角色。',application:'本產品由此提出反覆傳遞、集中聲援的行為假說；仍需本案原文與情境。',limit:'單一帳號重複或集中不等於確認協同、受雇或組織歸屬；沒有可直接套用的數值門檻。'},
 {id:'history',url:'https://www.readr.tw/post/2013',platform:'Twitter',basis:'調查報導與資料分析；不是本案帳號標籤',observation:'檢視長期語言、議題變化與轉推關係。',application:'只對有日期及實際歷史的變化提出解讀。',limit:'短期可見資料不能重建多年轉變；政治立場不是惡意標籤。'},
 {id:'timing',url:'https://www.readr.tw/post/2029',platform:'Twitter',basis:'調查報導與資料分析',observation:'觀察發言時段、帳號資料與行為變化，同時提醒單一時段特徵有誤判風險。',application:'時間資料可輔助解釋密集活動；名稱只用於核對公開資料一致性。',limit:'不能因上班時間發文、名字或尾碼認定假帳號；沒有提供 Threads 門檻或身分判定效力。'},
 {id:'context',url:'https://medium.com/watchout/fake-news-example-ec0959930e08',platform:'跨媒體',basis:'內容分類案例文章',observation:'區分訊息錯誤、脈絡錯置與意圖，不把各種內容問題混為一談。',application:'引述、諷刺、技術分享及例行互動須保留原文情境。',limit:'內容錯誤不直接證明作者受雇；自然反例是本產品的審查要求，並非此文驗證過的分類器。'}
];
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const need=(ok,message)=>{if(!ok)throw Error(message);};
const exactKeys=(x,allowed)=>object(x)&&Object.keys(x).length===allowed.length&&allowed.every(k=>Object.hasOwn(x,k));
const text=x=>typeof x==='string'&&x.trim().length>0;
const handle=h=>h.replace(/\.+$/,'').toLowerCase();
const handles=t=>t.match(/@[A-Za-z0-9_.]+/g)??[];
const uniqueIds=rows=>Array.isArray(rows)&&rows.every(r=>object(r)&&text(r.id))&&new Set(rows.map(r=>r.id)).size===rows.length;
function range(rows){const dates=rows.map(x=>x.postedAt).filter(x=>typeof x==='string'&&Number.isFinite(Date.parse(x))).sort();return {from:dates[0]??null,to:dates.at(-1)??null};}
export function buildAccountBehaviorInput(scan){
 const rows=[...(scan.posts??[]),...(scan.authoredReplies??scan.comments??[])];
 const byId=new Map();
 for(const row of rows){if(!row.id||row.author!==scan.account.username)continue;
  const id=`activity:${row.id}`;const evidence={id,kind:row.kind,text:row.text??'',author:row.author,postedAt:row.postedAt??null,url:row.url??null,parentUrl:row.parentUrl??null,parentAuthor:row.parentAuthor??null,parentText:null,isQuote:row.isQuote===true,isRepost:row.isRepost===true};
  if(byId.has(id)&&JSON.stringify(byId.get(id))!==JSON.stringify(evidence))throw Error('Conflicting activity versions');
  byId.set(id,evidence);
 }
 const evidence=[...byId.values()];
 return {account:{username:scan.account.username,name:scan.account.name??null,url:scan.account.url??null,nameHistory:null},coverage:{observedAt:scan.completedAt??null,posts:range(evidence.filter(x=>x.kind==='post')),replies:range(evidence.filter(x=>x.kind!=='post')),sampleOnly:true,parentContext:'原串僅有連結與作者，未取得內文',limitations:scan.coverage?.limitations??[]},evidence,research:structuredClone(behaviorResearch)};
}
export function validateAccountBehaviorInput(input){
 need(exactKeys(input,['account','coverage','evidence','research']),'Invalid behavior packet fields');
 need(object(input.account)&&object(input.coverage)&&uniqueIds(input.evidence)&&uniqueIds(input.research),'Invalid behavior packet');
 need(input.evidence.every(e=>typeof e.text==='string'),'Invalid activity text');
 return true;
}
/** strict (the default, for the offline preview and the publish gate) also rejects what behaviorWarnings would only flag;
 *  the site's AI service passes strict:false and shows the judgement with those warnings. */
export function validateAccountBehavior(input,output,{strict=true}={}){
 validateAccountBehaviorInput(input);
 need(exactKeys(output,['assessment','conclusion','findings','limitations']),'Unexpected behavior output field');
 need(['suspicious_behavior_observed','no_clear_suspicious_behavior','insufficient_evidence'].includes(output.assessment),'Invalid behavior assessment');
 need(text(output.conclusion)&&Array.from(output.conclusion).length<=240,'Invalid behavior conclusion');
 need(Array.isArray(output.findings)&&output.findings.length<=4&&Array.isArray(output.limitations)&&output.limitations.every(text),'Invalid findings/limitations');
 const hasActivity=input.evidence.some(e=>e.text.trim());
 need(output.assessment==='insufficient_evidence'||hasActivity&&output.findings.length>0,'Activity required for judgment');
 for(const f of output.findings){
  need(exactKeys(f,['behavior','judgment','observation','interpretation','alternative','evidence','researchIds']),'Unexpected finding field');
  // A missing alternative (never shown on the site) is a warning, missing_alternative.
  need(['concern','contextual','inconclusive'].includes(f.judgment)&&['behavior','observation','interpretation'].every(k=>text(f[k]))&&(f.alternative===null||typeof f.alternative==='string'),'Missing qualitative reasoning');
  need(f.observation!==f.interpretation,'Interpretation cannot copy observation');
  need(Array.isArray(f.evidence)&&f.evidence.length>0&&new Set(f.evidence.map(e=>e.evidenceId)).size===f.evidence.length,'Activity evidence required');
  // Whether the quote is really in that activity is a warning (behaviorWarnings), not a rejection. An empty quote is how
  // the model cites an image-only reply (no text to quote); it is checked there too.
  for(const e of f.evidence)need(exactKeys(e,['evidenceId','quote'])&&typeof e.quote==='string','Invalid activity quote');
  need(Array.isArray(f.researchIds)&&f.researchIds.length>0&&new Set(f.researchIds).size===f.researchIds.length&&f.researchIds.every(id=>input.research.some(r=>r.id===id)),'Unknown or missing research');
 }
 const concerns=output.findings.some(f=>f.judgment==='concern');
 need((output.assessment==='suspicious_behavior_observed')===concerns,'Assessment contradicts findings');
 const prose=proseOf(output);
 // Threads handles are case-insensitive and cannot end with a dot, so "@Bob." in a sentence is the account @bob.
 const permittedHandles=new Set([`@${input.account.username}`,...input.evidence.flatMap(e=>[e.parentAuthor?`@${e.parentAuthor}`:null,...handles(e.text)])].filter(Boolean).map(handle));
 need(handles(prose).every(a=>permittedHandles.has(handle(a))),'Invented account');
 if(strict){const warnings=behaviorWarnings(input,output);need(!warnings.includes('ungrounded_quote'),'Ungrounded activity quote');need(!warnings.includes('identity_label'),'Unsupported identity or score judgment');need(!warnings.includes('output_url'),'Output URLs must use evidence IDs');need(!warnings.includes('missing_alternative'),'Missing qualitative reasoning');}
 return true; // Structure only; quotes and labels are checked by behaviorWarnings, interpretation still needs human review.
}
const proseOf=output=>[output.conclusion,...output.limitations,...output.findings.flatMap(f=>[f.behavior,f.observation,f.interpretation,f.alternative??''])].join(' ');
// Felix 10-29: a judgement is always shown; like the semantic policy since #75, these two only flag it. They used to reject
// it (8 of 82 readings in a day, 7 of them Sonnet's). Labels are masked in the shown text (maskLabels): "不做網軍認定".
const LABELS=/網軍|機器人帳號|安全帳號|正常帳號|受雇帳號|國家操作|風險分數|可疑機率/g;
export const MASKED_LABEL='〔已移除標籤〕';
// A link the model wrote is masked like a label (output_url) unless the account itself posted it (juojinetain 10-22).
const URLS=/(?:https?:\/\/|www\.)[^\s「」『』（）()<>"'，。、]+/gi;
export const MASKED_URL='〔已移除連結〕';
const linkKey=u=>u.toLowerCase().replace(/^https?:\/\//,'').replace(/^www\./,'').replace(/[/.]+$/,'');
const postedLinks=input=>new Set(input.evidence.flatMap(e=>e.text.match(URLS)??[]).map(linkKey));
const maskUrls=(t,input)=>{const own=input?postedLinks(input):new Set();return String(t).replace(URLS,u=>own.has(linkKey(u))?u:MASKED_URL);};
export const maskLabels=(t,input=null)=>maskUrls(String(t).replace(LABELS,MASKED_LABEL),input);
// A quote counts as found when it is in the activity after NFKC and with whitespace dropped (models re-space and widen text).
const fold=t=>String(t).normalize('NFKC').replace(/\s+/g,'');
/** Warning codes for an output that passed validateAccountBehavior: 'ungrounded_quote' (a quote not in its activity, an
 *  empty quote of an activity that has text, or citing one that does not exist), 'identity_label' (an identity or
 *  score label such as 網軍), 'output_url' (a link the account did not post) and 'missing_alternative' (a finding
 *  without another explanation). */
export function behaviorWarnings(input,output){
 const warnings=[];
 const grounded=e=>{const source=input.evidence.find(x=>x.id===e.evidenceId);if(!source)return false;const q=fold(e.quote);return q?fold(source.text).includes(q):!fold(source.text);};
 if(output.findings.some(f=>!f.evidence.every(grounded)))warnings.push('ungrounded_quote');
 const prose=proseOf(output);
 if(prose.replace(LABELS,'')!==prose)warnings.push('identity_label');
 if(maskUrls(prose,input)!==prose)warnings.push('output_url');
 if(output.findings.some(f=>!text(f.alternative)))warnings.push('missing_alternative');
 return warnings;
}
