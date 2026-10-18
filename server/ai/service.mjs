import {validateBehaviorClaims} from './semantic-policy.mjs';
import {createHash} from 'node:crypto';
import {buildAccountBehaviorInput,validateAccountBehavior} from '../providers/account-behavior-preview.mjs';
const hash=x=>createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
// Collection diagnostics and profile URL aliases do not change the observed activities.
const cacheIdentity=input=>{const value=structuredClone(input);delete value.coverage.observedAt;delete value.coverage.limitations;delete value.account.url;return normalize(value);};
const normalize=x=>Array.isArray(x)?x.map(normalize):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,normalize(x[k])])):x;
// Throws with the first rule the model output breaks; returns the projection shown to readers.
function checkOutput(plan,raw){
 const candidate=raw?.candidates?.[0];if(candidate?.finishReason!=='STOP')throw Error(`incomplete: ${candidate?.finishReason??'no candidate'}`);
 if(raw.modelVersion&&raw.modelVersion!==plan.modelRevision)throw Error('model_revision_mismatch');
 const text=(candidate.content?.parts??[]).filter(p=>!p.thought).map(p=>p.text??'').join('');const output=JSON.parse(text);validateAccountBehavior(plan.input,output);validateBehaviorClaims(plan.input,output);
 return {text,projection:{assessment:output.assessment,conclusion:output.conclusion,findings:output.findings.map(f=>({title:f.behavior,text:f.interpretation}))}};
}
const messages={disabled:'AI 自動判讀尚未啟用。',not_configured:'AI 服務尚未設定。',no_data:'尚無可分析的發文或留言。',scan_not_ready:'帳號資料仍在處理。',budget_exceeded:'AI 判讀預算已不足，這次未送出生成。',preflight_failed:'AI 預檢未完成，可重新嘗試。',indeterminate:'AI 請求狀態未確認，已停止重送以避免重複計費。',invalid_output:'AI 輸出未通過檢查，暫不顯示判斷。',response_too_large:'本次資料超過 AI 判讀範圍。',not_requested:'這筆資料尚未產生 AI 判斷。'};
export class AiService{
 constructor({store,transport,prompt,enabled=false,configured=false,maxInputBytes=500000,model='gemini-3.8-flash',modelRevision='gemini-3.8-flash',maxOutputTokens=1800,now=Date.now,schedule=fn=>setImmediate(fn)}){
  if(model!=='gemini-3.8-flash'||modelRevision!=='gemini-3.8-flash')throw Error('Unpriced model revision');
  if(!Number.isInteger(maxOutputTokens)||maxOutputTokens<128||maxOutputTokens>2600)throw Error('Invalid output budget');
  if(!Number.isSafeInteger(maxInputBytes)||maxInputBytes<100000||maxInputBytes>500000)throw Error('Invalid input byte limit');
  Object.assign(this,{maxInputBytes,store,transport,prompt,enabled,configured,model,modelRevision,maxOutputTokens,now,schedule});
 }
 plan(scan){
  const input=buildAccountBehaviorInput(scan);input.evidence.sort((a,b)=>a.id.localeCompare(b.id));
  const identity=cacheIdentity(input);
  const body={systemInstruction:{parts:[{text:this.prompt}]},contents:[{role:'user',parts:[{text:JSON.stringify(input)}]}],generationConfig:{temperature:0,maxOutputTokens:this.maxOutputTokens,responseMimeType:'application/json',thinkingConfig:{thinkingLevel:'low'}}};
  const evidenceHash=hash(normalize(identity)),promptHash=hash(this.prompt),key=hash({account:input.account.username,evidenceHash,promptHash,model:this.model,modelRevision:this.modelRevision,contract:'account-behavior-v1',generationConfig:body.generationConfig});
  // Reuse jobs created before diagnostics were excluded, including invalid/indeterminate jobs.
  // Returning their original key preserves reservations and prevents a migration from retrying them.
  const existing=this.store.plansForAccount(input.account.username).find(p=>p.promptHash===promptHash&&p.model===this.model&&p.modelRevision===this.modelRevision&&p.contractVersion==='account-behavior-v1'&&hash(normalize(p.body.generationConfig))===hash(normalize(body.generationConfig))&&hash(cacheIdentity(p.input))===hash(identity));
  if(existing)return existing;
  return {key,input,body,model:this.model,modelRevision:this.modelRevision,evidenceHash,promptHash,contractVersion:'account-behavior-v1'};
 }
 response(plan){
  const job=this.store.get(plan.key);
  if(!job)return this.state('not_requested',{cacheKey:plan.key});
  if(job.status==='ready')return {status:'ready',cacheKey:plan.key,result:job.projection,provenance:{model:job.actual_model??plan.model,requestedModel:plan.model,modelRevision:plan.modelRevision,promptHash:plan.promptHash,evidenceHash:plan.evidenceHash,generatedAt:new Date(job.updated).toISOString(),validation:'structure_exact_citations_and_limited_claim_rules',semanticReview:'not_human_reviewed',source:'generated_for_this_evidence'}};
  if(job.status==='invalid')return this.state('invalid_output',{cacheKey:plan.key,retryAllowed:false});
  if(job.status==='error')return this.state(job.error,{cacheKey:plan.key,retryAllowed:['preflight_failed','budget_exceeded'].includes(job.error)});
  if(this.now()-job.updated>120000)return this.state('indeterminate',{cacheKey:plan.key,retryAllowed:false});
  return {status:'processing',phase:job.status,cacheKey:plan.key,pollAfterMs:1500,retryAllowed:false};
 }
 state(status,extra={}){return {status,message:messages[status]??messages.indeterminate,result:null,...extra};}
 capabilities(){return {enabled:this.enabled,configured:this.configured,model:this.model,modelRevision:this.modelRevision,promptHash:hash(this.prompt),maxOutputTokens:this.maxOutputTokens,maxInputBytes:this.maxInputBytes,budget:this.store.budget()};}
 /** Operator view of a rejected generation: the rule it broke and the model text. Never exposed publicly. */
 diagnose(scan){
  let plan;try{plan=this.plan(scan);}catch{return null;}
  const job=this.store.get(plan.key);if(!job)return {status:'not_requested'};
  if(job.status!=='invalid')return {status:job.status,error:job.error??null};
  try{checkOutput(plan,job.raw);return {status:'invalid',reason:'passes current rules'};}
  catch(e){const parts=job.raw?.candidates?.[0]?.content?.parts??[];return {status:'invalid',reason:String(e?.message??e),text:parts.filter(p=>!p.thought).map(p=>p.text??'').join('')};}
 }
 /** Re-checks a rejected output against the current rules without calling the model again. */
 revalidate(scan){
  let plan;try{plan=this.plan(scan);}catch{return null;}
  const job=this.store.get(plan.key);if(job?.status!=='invalid')return {status:job?.status??'not_requested'};
  let projection;try{({projection}=checkOutput(plan,job.raw));}catch(e){return {status:'invalid',reason:String(e?.message??e)};}
  this.store.release(plan.key,projection,this.now());return this.response(plan);
 }
 inspect(scan){if(scan.status!=='completed')return this.state('scan_not_ready');let plan;try{plan=this.plan(scan);}catch{return this.state('no_data');}if(!plan.input.evidence.some(e=>e.text.trim()))return this.state('no_data');return this.response(plan);}
 start(scan,{retry=false}={}){
  if(scan.status!=='completed')return this.state('scan_not_ready');let plan;try{plan=this.plan(scan);}catch{return this.state('no_data');}
  if(!plan.input.evidence.some(e=>e.text.trim()))return this.state('no_data');
  const prior=this.store.get(plan.key);if(prior&&!(retry&&['preflight_failed','budget_exceeded'].includes(prior.error)))return this.response(plan);
  if(!this.enabled)return this.state('disabled');if(!this.configured)return this.state('not_configured');
  if(Buffer.byteLength(JSON.stringify(plan.body))>this.maxInputBytes)return this.state('response_too_large');
  const claimed=prior?this.store.retryPreflight(plan.key,this.now()):this.store.claim(plan.key,plan,this.now());
  if(claimed)this.schedule(()=>this.work(plan.key).catch(()=>this.store.fail(plan.key,'indeterminate',this.now())));
  return this.response(plan);
 }
 async work(key){
  if(!this.store.counting(key,this.now()))return;
  const plan=this.store.get(key).plan;let count;
  try{count=await this.transport.count(plan);if(!Number.isSafeInteger(count)||count<1)throw Error();}catch{this.store.fail(key,'preflight_failed',this.now());return;}
  const reserve=((count+2048)*.75+this.maxOutputTokens*3.75)/1e6;
  if(!this.store.dispatch(key,reserve,this.now()))return;
  let raw;
  try{raw=await this.transport.generate(plan);}catch{this.store.fail(key,'indeterminate',this.now());return;}
  const usage=raw?.usageMetadata;
  const validUsage=usage&&Number.isSafeInteger(usage.promptTokenCount)&&usage.promptTokenCount>=0&&Number.isSafeInteger(usage.candidatesTokenCount)&&usage.candidatesTokenCount>=0&&(usage.thoughtsTokenCount===undefined||Number.isSafeInteger(usage.thoughtsTokenCount)&&usage.thoughtsTokenCount>=0);
  const actualUsd=validUsage?(usage.promptTokenCount*.75+(usage.candidatesTokenCount+(usage.thoughtsTokenCount??0))*3.75)/1e6:null;
  let projection,error;
  try{({projection}=checkOutput(plan,raw));}
  catch(e){error='invalid_output';console.log(JSON.stringify({message:'ai invalid output',key,reason:String(e?.message??e).slice(0,300)}));}
  this.store.settle(key,{raw,usage:usage??null,actualUsd,projection:projection??null,status:error?'invalid':'ready',error,actualModel:raw.modelVersion??null},this.now());
 }
}
