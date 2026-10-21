import {analyze} from './analysis.mjs';
import {scanCollectionProfile} from './collection-profile.mjs';
import {signalScore} from '../shared/signals.mjs';
import {PRECHECK_TTL_MS} from './providers/threads-profile.mjs';
import {SCAN_ERROR_MESSAGES} from './scan-messages.mjs';
import {log,timer} from '../worker/log.mjs';
export {SCAN_ERROR_MESSAGES};
const BUDGET_CODES=new Set(['BUDGET_EXCEEDED','DAILY_BUDGET_EXCEEDED']);
const PRECHECK_CODES={not_found:'ACCOUNT_NOT_FOUND',private:'ACCOUNT_PRIVATE'};
// A missing or private account fails here, before any paid job starts, so no budget is reserved. Only clear answers
// are cached, for 10 minutes in case the account is created or made public; any other answer lets the scan run.
async function precheckAccount(username,{store,precheck}){
 const key=`precheck:${username.toLowerCase()}`;
 let verdict=await store.cacheGet(key);
 if(!verdict){verdict=await precheck(username).catch(()=>({status:'unknown'}));if(PRECHECK_CODES[verdict?.status])await store.cacheSet(key,verdict,PRECHECK_TTL_MS);}
 const code=PRECHECK_CODES[verdict?.status];
 if(code)throw Object.assign(new Error(SCAN_ERROR_MESSAGES[code]),{code});
}
/** Runs one scan to completion or failure. `store` is the Node Store or an async Durable Object stub;
 *  every call is awaited so both work. Resumes saved provider jobs instead of dispatching them again.
 *  `precheck(username)` is the free account check, run only before the first paid job; null skips it. */
export async function runScan(id,{store,fetchAccount,precheck=null,crossAccountSearch=false,resumable=false}){
 // Progress writes are chained so a late one can never land after the final result, and are awaited before it.
 let progress=Promise.resolve();
 // durationMs is this attempt's time; a resumed Worker scan spans several alarms, so the ends are logged per attempt.
 const elapsed=timer();let username;
 try{
  const scan=await store.get(id);username=scan?.account?.username;
  const state=await store.getState(id);
  if(precheck&&!Object.keys(state.jobs??{}).length){await store.update(id,{status:'running',progress:'確認帳號存在且公開'});await precheckAccount(scan.account.username,{store,precheck});}
  await store.update(id,{status:'running',progress:'取得公開發文與留言'});
  // Posts and replies arrive at different times. Each finished job is saved under `partial` so a running scan
  // can show it; a resumed run starts from what an earlier alarm saved. Never scored; cleared when the scan ends.
  const partial={...scan.partial};
  const write=patch=>{progress=progress.then(()=>store.update(id,patch)).catch(()=>{});};
  const bundle=await fetchAccount(scan.account.username,{crossAccountSearch,profileId:scanCollectionProfile(scan).id,state,budget:store.budget,onState:s=>store.setState(id,s),onProgress:p=>write({progress:typeof p==='string'?p:p.message??'正在取得資料'}),onPartial:p=>{Object.assign(partial,p);write({partial:{...partial}});}});
  await progress;
  // Nothing came back and every collection step failed: that is a fetch failure, not an empty account. Saving it
  // as completed would serve it from the cache forever, so fail the scan; asking again resumes the failed scan.
  const steps=bundle.collection?.steps??[];
  if(steps.length&&steps.every(s=>s.status==='failed')&&!bundle.posts?.length&&!bundle.comments?.length)throw Object.assign(new Error('取數全部失敗，未取得可分析資料。'),{code:steps.find(s=>Object.hasOwn(SCAN_ERROR_MESSAGES,s.errorCode))?.errorCode??'PROVIDER_FAILED',collection:{...bundle.collection,status:'failed'}});
  const old=await store.comparison(scan.account.username,[...(bundle.posts??[]),...(bundle.comments??[])]);
  // Local corpus is evidence only; never invent completed search IDs.
  if(old.length){bundle.comparison=[...(bundle.comparison??[]),...old];bundle.limitations=[...(bundle.limitations??[]),`另比對資料庫已查詢紀錄 ${old.length} 筆；資料庫只涵蓋先前查詢的帳號。`];}
  const result=analyze(bundle);
  await store.saveEvidence(id,[...result.posts,...result.comments,...(bundle.comparison??[])]);
  const finished=await store.update(id,{...result,...(bundle.collection?{collection:bundle.collection}:{}),account:bundle.account,status:'completed',partial:null,progress:bundle.collection?.status==='partial'?'部分分析完成，取數缺項請查看原因':result.posts.length||result.comments.length?'分析完成':'資料不足，未取得可分析紀錄',completedAt:new Date().toISOString()});
  finished.score=signalScore(finished);
  await store.update(id,{score:finished.score});await store.saveAnalysis(id,finished);await store.cacheSet(`scan:${scan.account.username}`,finished);
  log('info','scan.completed',{scanId:id,username,status:'completed',durationMs:elapsed(),posts:result.posts.length,comments:result.comments.length,collection:bundle.collection?.status,score:finished.score?.value});
  return {status:'completed'};
 }catch(e){
  await progress;
  // A host that resumes later (the Worker scan job) keeps the scan running instead of reporting a failure.
  if(resumable&&e.code==='APIFY_PENDING'){await store.update(id,{status:'running',error:null,progress:'Apify 任務仍在處理，稍後自動繼續'});log('info','scan.pending',{scanId:id,username,code:e.code,durationMs:elapsed()});return {status:'pending',code:e.code};}
  const code=Object.hasOwn(SCAN_ERROR_MESSAGES,e.code)?e.code:'PROVIDER_FAILED',message=SCAN_ERROR_MESSAGES[code];
  log('warn','scan.failed',{scanId:id,username,status:'failed',code,cause:e.code??e.name,durationMs:elapsed(),error:e});
  const current=BUDGET_CODES.has(code)?await store.get(id):null;
  await store.update(id,{status:'failed',partial:null,progress:message,completedAt:new Date().toISOString(),error:{code,message},...(e.collection?{collection:e.collection}:{}),...(current?{analysis:{...current.analysis,factChecks:{status:'not_executed',items:[],reason:'帳號取數未完成，未執行主張擷取或相關查核。',errorCode:code}}}:{})});
  return {status:'failed',code,cause:e.code??e.name};
 }
}
