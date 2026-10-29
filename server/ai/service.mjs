import {validateBehaviorClaims} from './semantic-policy.mjs';
import {createHash} from 'node:crypto';
import {buildAccountBehaviorInput,validateAccountBehavior,behaviorWarnings,maskLabels} from '../providers/account-behavior-preview.mjs';
import {log,timer} from '../../worker/log.mjs';
const hash=x=>createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
// Collection diagnostics and profile URL aliases do not change the observed activities.
const cacheIdentity=input=>{const value=structuredClone(input);delete value.coverage.observedAt;delete value.coverage.limitations;delete value.account.url;return normalize(value);};
const normalize=x=>Array.isArray(x)?x.map(normalize):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,normalize(x[k])])):x;
// Throws when the output is incomplete or malformed; returns the projection shown to readers. Wording rules (semantic
// policy), quotes not found in their activity and identity labels only warn: the judgement is still shown, with the
// flagged rules attached and the labels masked.
function checkOutput(plan,raw){
 const candidate=raw?.candidates?.[0];if(candidate?.finishReason!=='STOP')throw Error(`incomplete: ${candidate?.finishReason??'no candidate'}`);
 if(raw.modelVersion&&raw.modelVersion!==plan.modelRevision)throw Error('model_revision_mismatch');
 const text=(candidate.content?.parts??[]).filter(p=>!p.thought).map(p=>p.text??'').join('');const output=JSON.parse(text);validateAccountBehavior(plan.input,output,{strict:false});
 const warnings=behaviorWarnings(plan.input,output);try{validateBehaviorClaims(plan.input,output);}catch(e){if(e.code!=='SEMANTIC_POLICY_FAILED')throw e;warnings.push(...e.problems);}
 return {text,warnings,projection:{assessment:output.assessment,conclusion:maskLabels(output.conclusion),findings:output.findings.map(f=>({title:maskLabels(f.behavior),text:maskLabels(f.interpretation)})),...(warnings.length?{policyWarnings:warnings}:{})}};
}
// The provider answered 429/401/403 (Claude also 529): the request was refused, not processed, so it is not billed and may be retried.
const REJECTED=new Set(['rate_limited','auth_failed']);
const RETRYABLE=['preflight_failed','budget_exceeded','provider_rejected'];
// Failures that never billed this provider and so may be answered by the fallback provider instead.
const FALLBACK_ON=new Set(['preflight_failed','provider_rejected']);
const messages={disabled:'AI 自動判讀尚未啟用。',not_configured:'AI 服務尚未設定。',no_data:'尚無可分析的發文或留言。',scan_not_ready:'帳號資料仍在處理。',budget_exceeded:'AI 判讀預算已不足，這次未送出生成。',preflight_failed:'AI 預檢未完成，可重新嘗試。',provider_rejected:'AI 服務暫時拒絕這次請求（未計費），可重新嘗試。',indeterminate:'AI 請求狀態未確認，已停止重送以避免重複計費。',invalid_output:'AI 輸出未通過檢查，暫不顯示判斷。',response_too_large:'本次資料超過 AI 判讀範圍。',not_requested:'這筆資料尚未產生 AI 判斷。'};
// USD per 1M tokens. Gemini is priced here; other transports carry their own `pricing` (see claude.mjs).
const GEMINI_PRICING={inputUsdPerM:.75,outputUsdPerM:3.75};
const priced=p=>p&&Number.isFinite(p.inputUsdPerM)&&Number.isFinite(p.outputUsdPerM)&&p.inputUsdPerM>=0&&p.outputUsdPerM>=0;
export class AiService{
 // The transport names its provider, model and price; a bare {count,generate} transport means Gemini 3.8 Flash.
 // fallback: another AiService on the same store that takes over a job this provider refused before billing it
 // (preflight failed, 429/401/403 on generate). Its judgement is shown in place of the refused one.
 constructor({store,transport,prompt,enabled=false,configured=false,maxInputBytes=500000,model=transport?.model??'gemini-3.8-flash',modelRevision=transport?.modelRevision??model,maxOutputTokens=1800,now=Date.now,schedule=fn=>setImmediate(fn),fallback=null}){
  const provider=transport?.provider??'gemini';
  const pricing=transport?.pricing??(model==='gemini-3.8-flash'&&modelRevision==='gemini-3.8-flash'?GEMINI_PRICING:null);
  // Spend is estimated and capped with this price, so an unpriced model never runs.
  if(!priced(pricing))throw Error('Unpriced model revision');
  if(!Number.isInteger(maxOutputTokens)||maxOutputTokens<128||maxOutputTokens>2600)throw Error('Invalid output budget');
  if(!Number.isSafeInteger(maxInputBytes)||maxInputBytes<100000||maxInputBytes>500000)throw Error('Invalid input byte limit');
  if(fallback&&(fallback.store!==store||fallback.model===model))throw Error('Invalid fallback service');
  Object.assign(this,{maxInputBytes,store,transport,prompt,enabled,configured,provider,pricing,model,modelRevision,maxOutputTokens,now,schedule,fallback});
 }
 /** Log event names keep the provider as prefix: gemini.generate (unchanged) and claude.generate. */
 event(name){return `${this.provider}.${name}`;}
 plan(scan){const input=buildAccountBehaviorInput(scan);input.evidence.sort((a,b)=>a.id.localeCompare(b.id));return this.planInput(input);}
 /** Plans from an already built input, so a fallback service can adopt the exact input the refused job used. */
 planInput(input){
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
  // Outputs rejected only for wording before the rules became warnings are shown now, without calling the model again.
  if(job.status==='invalid'&&job.raw){let projection;try{({projection}=checkOutput(plan,job.raw));}catch{}if(projection&&this.store.release(plan.key,projection,this.now()))return this.response(plan);}
  if(job.status==='ready')return {status:'ready',cacheKey:plan.key,result:job.projection,provenance:{provider:this.provider,model:job.actual_model??plan.model,requestedModel:plan.model,modelRevision:plan.modelRevision,promptHash:plan.promptHash,evidenceHash:plan.evidenceHash,generatedAt:new Date(job.updated).toISOString(),validation:job.projection?.policyWarnings?.length?'structure_exact_citations_wording_flagged':'structure_exact_citations_and_limited_claim_rules',semanticReview:'not_human_reviewed',source:'generated_for_this_evidence'}};
  if(job.status==='invalid')return this.state('invalid_output',{cacheKey:plan.key,retryAllowed:false});
  if(job.status==='error')return this.state(job.error,{cacheKey:plan.key,retryAllowed:RETRYABLE.includes(job.error)});
  if(this.now()-job.updated>120000)return this.state('indeterminate',{cacheKey:plan.key,retryAllowed:false});
  // First poll about 10 s after the request (generation takes ~9 s), then every 1.5 s.
  const age=this.now()-(job.created??job.updated);
  return {status:'processing',phase:job.status,cacheKey:plan.key,pollAfterMs:Math.max(1500,10000-age),retryAllowed:false};
 }
 state(status,extra={}){return {status,message:messages[status]??messages.indeterminate,result:null,...extra};}
 capabilities(){return {enabled:this.enabled,configured:this.configured,provider:this.provider,model:this.model,modelRevision:this.modelRevision,promptHash:hash(this.prompt),maxOutputTokens:this.maxOutputTokens,maxInputBytes:this.maxInputBytes,budget:this.store.budget(),fallback:this.fallback?{provider:this.fallback.provider,model:this.fallback.model,configured:this.fallback.configured,maxOutputTokens:this.fallback.maxOutputTokens}:null};}
 /** A refused job (never billed) shows the fallback's judgement when one exists; the fallback runs under its own key. */
 withFallback(result,plan){
  if(!this.fallback||!FALLBACK_ON.has(result.status))return result;
  const other=this.fallback.response(this.fallback.planInput(plan.input));
  return other.status==='not_requested'?result:{...other,fallbackFrom:this.provider};
 }
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
 inspect(scan){if(scan.status!=='completed')return this.state('scan_not_ready');let plan;try{plan=this.plan(scan);}catch{return this.state('no_data');}if(!plan.input.evidence.some(e=>e.text.trim()))return this.state('no_data');return this.withFallback(this.response(plan),plan);}
 start(scan,{retry=false}={}){
  if(scan.status!=='completed')return this.state('scan_not_ready');let plan;try{plan=this.plan(scan);}catch{return this.state('no_data');}
  if(!plan.input.evidence.some(e=>e.text.trim()))return this.state('no_data');
  const prior=this.store.get(plan.key);if(prior&&!(retry&&RETRYABLE.includes(prior.error)))return this.withFallback(this.response(plan),plan);
  return this.startPlan(plan,prior);
 }
 startPlan(plan,prior=this.store.get(plan.key)){
  if(!this.enabled)return this.state('disabled');if(!this.configured)return this.state('not_configured');
  if(Buffer.byteLength(JSON.stringify(plan.body))>this.maxInputBytes)return this.state('response_too_large');
  const claimed=prior?this.store.retryPreflight(plan.key,this.now()):this.store.claim(plan.key,plan,this.now());
  if(claimed)this.schedule(()=>this.work(plan.key).catch(()=>this.store.fail(plan.key,'indeterminate',this.now())));
  return this.response(plan);
 }
 /** Hands a job this provider refused to the fallback service, which plans the same input under its own model. */
 handOff(plan,status){
  if(!this.fallback)return;
  const other=this.fallback.planInput(plan.input),result=this.fallback.startPlan(other);
  log('info','ai.fallback',{from:this.provider,to:this.fallback.provider,model:this.fallback.model,username:plan.input?.account?.username,status,fallbackStatus:result.status});
 }
 async work(key){
  if(!this.store.counting(key,this.now()))return;
  const plan=this.store.get(key).plan,username=plan.input?.account?.username,elapsed=timer(this.now);let count;
  try{count=await this.transport.count(plan);if(!Number.isSafeInteger(count)||count<1)throw Error();}catch(e){this.store.fail(key,'preflight_failed',this.now());log('warn',this.event('failed'),{provider:this.provider,key,username,status:'preflight_failed',reason:e?.message,durationMs:elapsed()});this.handOff(plan,'preflight_failed');return;}
  const {inputUsdPerM,outputUsdPerM}=this.pricing;
  const reserve=((count+2048)*inputUsdPerM+this.maxOutputTokens*outputUsdPerM)/1e6;
  if(!this.store.dispatch(key,reserve,this.now()))return;
  let raw;
  try{raw=await this.transport.generate(plan);}catch(e){const status=REJECTED.has(e?.message)?'provider_rejected':'indeterminate';if(status==='provider_rejected')this.store.reject(key,status,this.now());else this.store.fail(key,status,this.now());log('warn',this.event('failed'),{provider:this.provider,key,username,status,reason:e?.message,promptTokens:count,reservedUsd:reserve,durationMs:elapsed()});if(status==='provider_rejected')this.handOff(plan,status);return;}
  const usage=raw?.usageMetadata;
  const validUsage=usage&&Number.isSafeInteger(usage.promptTokenCount)&&usage.promptTokenCount>=0&&Number.isSafeInteger(usage.candidatesTokenCount)&&usage.candidatesTokenCount>=0&&(usage.thoughtsTokenCount===undefined||Number.isSafeInteger(usage.thoughtsTokenCount)&&usage.thoughtsTokenCount>=0);
  const actualUsd=validUsage?(usage.promptTokenCount*inputUsdPerM+(usage.candidatesTokenCount+(usage.thoughtsTokenCount??0))*outputUsdPerM)/1e6:null;
  let projection,error;
  try{let warnings;({projection,warnings}=checkOutput(plan,raw));if(warnings.length)log('info',this.event('policy_warnings'),{provider:this.provider,key,username,warnings});}
  catch(e){error='invalid_output';log('warn',this.event('invalid_output'),{provider:this.provider,key,username,reason:String(e?.message??e).slice(0,300)});}
  this.store.settle(key,{raw,usage:usage??null,actualUsd,projection:projection??null,status:error?'invalid':'ready',error,actualModel:raw.modelVersion??null},this.now());
  log('info',this.event('generate'),{provider:this.provider,key,username,status:error?'invalid':'ready',model:raw.modelVersion??this.model,promptTokens:usage?.promptTokenCount,outputTokens:usage?.candidatesTokenCount,thoughtsTokens:usage?.thoughtsTokenCount,reservedUsd:reserve,usd:actualUsd,durationMs:elapsed()});
 }
}
