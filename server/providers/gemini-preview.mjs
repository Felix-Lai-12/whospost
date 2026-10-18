// Offline only. No env/key access, SDK imports or network transport.
import {readFile} from 'node:fs/promises';
import {validateAccountBehavior,validateAccountBehaviorInput} from './account-behavior-preview.mjs';
const tasks=new Set(['cofacts-relevance','plain-summary','account-behavior']);
export async function buildGeminiPreview(task,input){
 if(!tasks.has(task))throw Error('Unknown task');
 if(task==='account-behavior')validateAccountBehaviorInput(input);
 const prompt=await readFile(new URL(`../../prompts/${task}.md`,import.meta.url),'utf8');
 return {mode:'offline-preview',networkEnabled:false,reviewRequired:true,model:'gemini-flash-latest',modelSelection:'existing alias; not validated by an API call',body:{systemInstruction:{parts:[{text:prompt}]},contents:[{role:'user',parts:[{text:JSON.stringify(input)}]}],generationConfig:{temperature:0,responseMimeType:'application/json'}}};
}
const fail=message=>{throw Error(message);};
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const keys=(x,allowed)=>object(x)&&Object.keys(x).every(k=>allowed.includes(k));
const length=text=>Array.from(text).length;
const plain=text=>typeof text==='string'&&text.trim().length>0&&!/主張|候選|快照|https?:\/\/|www\./i.test(text);
const forbidden=text=>/網軍機率|安全帳號|正常帳號|正常範圍|已排除協同|本工具確認|我們已確認|已驗證來源|官方證實/.test(text);
const numbers=text=>String(text).replace(/@[A-Za-z0-9_.]+/g,'').normalize('NFKC').match(/\d+(?:\.\d+)?%?/g)??[];
const accounts=text=>String(text).match(/@[A-Za-z0-9_.]+/g)??[];
const subsequence=(sequence,source)=>{let i=0;for(const item of source)if(item===sequence[i])i++;return i===sequence.length;};
const usable=s=>['factcheck_reply','reference_excerpt'].includes(s.kind)&&(!s.status||s.status==='NORMAL');
export function validatePreview(task,input,output){
 if(!object(input)||!object(output))fail('Invalid input/output');
 if(task==='account-behavior')return validateAccountBehavior(input,output);
 if(task==='cofacts-relevance'){
  if(!keys(output,['status','sentence','answer','evidence']))fail('Unexpected relevance field');
  if(!['related','unrelated','insufficient','conflicting','no_match','not_checkable'].includes(output.status))fail('Invalid status');
  if(typeof input.sentence!=='string'||output.sentence!==input.sentence||!plain(output.answer)||length(output.answer)>100||forbidden(output.answer))fail('Invalid sentence/answer');
  if(!Array.isArray(input.sources)||input.sources.some(s=>!object(s)||typeof s.id!=='string'||!s.id||typeof s.text!=='string')||new Set(input.sources.map(s=>s.id)).size!==input.sources.length)fail('Invalid or ambiguous sources');
  if(!Array.isArray(output.evidence))fail('Missing evidence');
  const cited=[];
  for(const e of output.evidence){if(!keys(e,['sourceId','quote']))fail('Unexpected evidence field');const s=input.sources.find(s=>s.id===e.sourceId);if(!s||typeof e.quote!=='string'||!e.quote.trim()||!s.text.includes(e.quote))fail('Ungrounded quote');if(s.status&&s.status!=='NORMAL')fail('Unavailable source');
   const before=s.text.slice(Math.max(0,s.text.indexOf(e.quote)-10),s.text.indexOf(e.quote));
   if(/(?:沒有|並非|並未|不是|不得|不能|未|不)[^，。；！？\n]{0,6}$/u.test(before)&&!/(?:沒有|並非|並未|不是|不得|不能|未|不)/u.test(e.quote))fail('Truncated negation');
   cited.push(s);}
  const groundedText=[input.sentence,...cited.map(s=>s.text)].join(' ');
  const allowedNumbers=new Set(numbers(groundedText)),allowedAccounts=new Set(accounts(groundedText));
  if(numbers(output.answer).some(x=>!allowedNumbers.has(x))||accounts(output.answer).some(x=>!allowedAccounts.has(x)))fail('Invented answer number/account');
  if(output.status==='related'&&!cited.some(usable))fail('Related requires usable reply or excerpt');
  if(output.status==='unrelated'&&!cited.length)fail('Unrelated requires difference evidence');
  if(output.status==='conflicting'){
   const replies=cited.filter(s=>s.kind==='factcheck_reply'&&usable(s));
   if(new Set(replies.map(s=>s.replyId??s.id)).size<2)fail('Conflict requires two distinct replies');
   const types=replies.map(s=>s.replyType).filter(Boolean);
   if(types.length&&!(types.includes('RUMOR')&&types.includes('NOT_RUMOR')))fail('Conflict classification unsupported');
  }
  if(output.status==='no_match'&&(input.lookupStatus!=='completed'||input.sources.length))fail('Search not completed or sources not empty');
 }else if(task==='plain-summary'){
  if(!keys(output,['conclusion','reasons'])||!Array.isArray(output.reasons)||output.reasons.length>2)fail('Invalid summary fields');
  if(!Array.isArray(input.facts)||input.facts.some(f=>!object(f)||typeof f.id!=='string'||!f.id||typeof f.text!=='string')||new Set(input.facts.map(f=>f.id)).size!==input.facts.length)fail('Invalid or ambiguous facts');
  const texts=new Set();
  for(const [i,row]of [output.conclusion,...output.reasons].entries()){
   if(!keys(row,['text','factIds'])||!plain(row.text)||length(row.text)>(i===0?45:100)||!Array.isArray(row.factIds)||!row.factIds.length||new Set(row.factIds).size!==row.factIds.length)fail('Invalid summary');
   const facts=row.factIds.map(id=>input.facts.find(f=>f.id===id));if(facts.some(f=>!f))fail('Unknown fact');
   const source=facts.map(f=>f.text).join(' '),numericSource=numbers(source),numericOutput=numbers(row.text);
   if(!subsequence(numericOutput,numericSource))fail('Invented or reordered numbers');
   const sourceAccounts=new Set(accounts(source));if(accounts(row.text).some(a=>!sourceAccounts.has(a)))fail('Invented account');
   if(forbidden(row.text))fail('Unsupported identity or verification judgment');
   if(/全部留言|所有留言/.test(row.text)&&!/全部留言|所有留言/.test(source))fail('Expanded population');
   const canonical=row.text.replace(/[\p{P}\p{S}\s]/gu,'');if(texts.has(canonical))fail('Repeated conclusion/reason');texts.add(canonical);
  }
 }else fail('Unknown task');
 return true; // Citation/format guards are not a semantic grader or model evaluation.
}
export function runGemini(){throw Error('Gemini API disabled: review local prompts and reference outputs first');}
