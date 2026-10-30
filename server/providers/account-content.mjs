// The AI content judgement (signals-v3 item 8, 「AI 判讀內容異常」; plan-signal7-family-20261029 10-30 修訂): does the
// account's own text carry high-grade hate speech against an identity group? Only its own posts and replies go in, no
// parents and no research cards. The answer is short: yes or no, the verbatim sentences behind a yes, and which groups.
// Felix 10-29: when unsure, no. So a yes whose sentences cannot be found word for word in the account's own text is
// read as no, never as a yes or an error.
const need=(ok,message)=>{if(!ok)throw Error(message);};
const exactKeys=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
export const CONTENT_TARGETS=Object.freeze(['族群','國籍','宗教','性別','性傾向','性別認同','身心障礙','其他身分群體']);
const MAX_QUOTES=3,MIN_QUOTE=4;
/** The packet the model reads: the account and each of its own posts and replies with text (reposts are not its words). */
export function buildAccountContentInput(scan){
 const rows=[...(scan.posts??[]),...(scan.authoredReplies??scan.comments??[])],byId=new Map();
 for(const row of rows){
  if(!row.id||row.author!==scan.account.username||row.isRepost===true||typeof row.text!=='string'||!row.text.trim())continue;
  byId.set(`activity:${row.id}`,{id:`activity:${row.id}`,kind:row.kind,text:row.text});
 }
 return {account:{username:scan.account.username},evidence:[...byId.values()]};
}
/** Throws on a malformed answer; returns what readers see: {hateful, quotes, targets}, with a yes kept only when at
 *  least one sentence is found verbatim in the text it names (unverified: true marks a yes that was read as no). */
export function projectAccountContent(input,output){
 need(exactKeys(output,['hateful','quotes','targets']),'Unexpected content output field');
 need(typeof output.hateful==='boolean','Invalid content verdict');
 need(Array.isArray(output.quotes)&&output.quotes.length<=MAX_QUOTES&&output.quotes.every(q=>exactKeys(q,['evidenceId','quote'])&&typeof q.evidenceId==='string'&&typeof q.quote==='string'),'Invalid content quotes');
 need(Array.isArray(output.targets)&&output.targets.every(t=>typeof t==='string'),'Invalid content targets');
 if(!output.hateful)return {hateful:false,quotes:[],targets:[]};
 const text=new Map(input.evidence.map(e=>[e.id,e.text]));
 const quotes=output.quotes.map(q=>({evidenceId:q.evidenceId,quote:q.quote.trim()})).filter(q=>Array.from(q.quote).length>=MIN_QUOTE&&text.get(q.evidenceId)?.includes(q.quote));
 const targets=[...new Set(output.targets.filter(t=>CONTENT_TARGETS.includes(t)))];
 return quotes.length?{hateful:true,quotes,targets}:{hateful:false,quotes:[],targets:[],unverified:true};
}
