import {analyze} from './analysis.mjs';
import {scanCollectionProfile} from './collection-profile.mjs';
import {signalScore} from '../shared/signals.mjs';
export const SCAN_ERROR_MESSAGES={APIFY_TOKEN_MISSING:'尚未設定 Apify token，請完成本機設定後再試。',MISSING_TOKEN:'尚未設定 Apify token，請完成本機設定後再試。',APIFY_NOT_CONFIGURED:'尚未設定 Apify token，請完成本機設定後再試。',APIFY_AUTH:'Apify 驗證失敗，請檢查本機 token。',BUDGET_EXCEEDED:'本輪預算不足，取數未完成；不能判定帳號沒有內容。',DAILY_BUDGET_EXCEEDED:'今天的查詢額度已用完，取數未完成；不能判定帳號沒有內容。',APIFY_PENDING:'Apify 任務仍在處理；再次查詢會恢復同一筆任務。',APIFY_UNKNOWN_RUN:'先前任務的送出狀態不明。為避免重複計費，已停止自動重送，需確認 Apify 任務紀錄。',APIFY_INDETERMINATE:'先前任務狀態不明，已停止自動重送，需確認 Apify 任務紀錄。',PROVIDER_TIMEOUT:'資料取得逾時，重新查詢將沿用已儲存的任務。',ACCOUNT_NOT_FOUND:'無法取得這個公開帳號的資料。',PROVIDER_FAILED:'資料取得失敗，尚無法分析；失敗不等於 0 分。',APIFY_ERROR:'資料來源回傳錯誤，尚無法分析。'};
const BUDGET_CODES=new Set(['BUDGET_EXCEEDED','DAILY_BUDGET_EXCEEDED']);
/** Runs one scan to completion or failure. `store` is the Node Store or an async Durable Object stub;
 *  every call is awaited so both work. Resumes saved provider jobs instead of dispatching them again. */
export async function runScan(id,{store,fetchAccount,crossAccountSearch=false,resumable=false}){
 // Progress writes are chained so a late one can never land after the final result, and are awaited before it.
 let progress=Promise.resolve();
 try{
  const scan=await store.get(id);
  await store.update(id,{status:'running',progress:'取得公開發文與留言'});
  // Posts and replies arrive at different times. Each finished job is saved under `partial` so a running scan
  // can show it; a resumed run starts from what an earlier alarm saved. Never scored; cleared when the scan ends.
  const partial={...scan.partial};
  const write=patch=>{progress=progress.then(()=>store.update(id,patch)).catch(()=>{});};
  const bundle=await fetchAccount(scan.account.username,{crossAccountSearch,profileId:scanCollectionProfile(scan).id,state:await store.getState(id),budget:store.budget,onState:s=>store.setState(id,s),onProgress:p=>write({progress:typeof p==='string'?p:p.message??'正在取得資料'}),onPartial:p=>{Object.assign(partial,p);write({partial:{...partial}});}});
  await progress;
  const old=await store.comparison(scan.account.username,[...(bundle.posts??[]),...(bundle.comments??[])]);
  // Local corpus is evidence only; never invent completed search IDs.
  if(old.length){bundle.comparison=[...(bundle.comparison??[]),...old];bundle.limitations=[...(bundle.limitations??[]),`另比對資料庫已查詢紀錄 ${old.length} 筆；資料庫只涵蓋先前查詢的帳號。`];}
  const result=analyze(bundle);
  await store.saveEvidence(id,[...result.posts,...result.comments,...(bundle.comparison??[])]);
  const finished=await store.update(id,{...result,...(bundle.collection?{collection:bundle.collection}:{}),account:bundle.account,status:'completed',partial:null,progress:bundle.collection?.status==='partial'?'部分分析完成，取數缺項請查看原因':result.posts.length||result.comments.length?'分析完成':'資料不足，未取得可分析紀錄',completedAt:new Date().toISOString()});
  finished.score=signalScore(finished);
  await store.update(id,{score:finished.score});await store.saveAnalysis(id,finished);await store.cacheSet(`scan:${scan.account.username}`,finished);
  return {status:'completed'};
 }catch(e){
  await progress;
  // A host that resumes later (the Worker scan job) keeps the scan running instead of reporting a failure.
  if(resumable&&e.code==='APIFY_PENDING'){await store.update(id,{status:'running',error:null,progress:'Apify 任務仍在處理，稍後自動繼續'});return {status:'pending',code:e.code};}
  const code=Object.hasOwn(SCAN_ERROR_MESSAGES,e.code)?e.code:'PROVIDER_FAILED',message=SCAN_ERROR_MESSAGES[code];
  const current=BUDGET_CODES.has(code)?await store.get(id):null;
  await store.update(id,{status:'failed',partial:null,progress:message,completedAt:new Date().toISOString(),error:{code,message},...(e.collection?{collection:e.collection}:{}),...(current?{analysis:{...current.analysis,factChecks:{status:'not_executed',items:[],reason:'帳號取數未完成，未執行主張擷取或相關查核。',errorCode:code}}}:{})});
  return {status:'failed',code,cause:e.code??e.name};
 }
}
