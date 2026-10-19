import {StoreCore} from '../server/store-core.mjs';
import {AiStoreCore} from '../server/ai/store-core.mjs';
import {AiService} from '../server/ai/service.mjs';
import {geminiTransport} from '../server/ai/gemini.mjs';
import {doSql} from './do-sql.mjs';
import {signalScore} from '../shared/signals.mjs';
const number=(value,fallback)=>value===undefined||value===''?fallback:Number(value);
const budgetError=e=>({ok:false,code:e.code??'BUDGET_ERROR',message:e.message});
/**
 * The single data Durable Object: scans, evidence, Apify budget, IP quota and the AI ledger share one SQLite
 * database, so every check-and-reserve is atomic. Methods are called over RPC by the Worker and scan jobs.
 * Kept free of cloudflare:workers imports so Node tests can drive it with a fake storage.
 */
export class StoreObjectCore{
 constructor(ctx,env,{prompt,fetchImpl=globalThis.fetch,now=Date.now}){
  const db=doSql(ctx.storage),tx=fn=>ctx.storage.transactionSync(fn);
  this.ctx=ctx;
  this.ai=new AiStoreCore(db,{limitUsd:number(env.WHOSPOST_AI_LIMIT_USD,1),tx,
   // AI spend shares the daily cap with Apify.
   admit:reserve=>this.store.dailyLimitUsd===null||this.store.dailyCommittedUsd()+reserve/1e6<=this.store.dailyLimitUsd+1e-8});
  this.store=new StoreCore(db,{budgetLimitUsd:number(env.WHOSPOST_APIFY_LIMIT_USD,2),dailyLimitUsd:number(env.WHOSPOST_DAILY_LIMIT_USD,1),tx,extraDailyUsd:since=>this.ai.committedSinceUsd(since),now});
  this.service=new AiService({store:this.ai,transport:geminiTransport({getApiKey:()=>env.GEMINI_API_KEY,fetchImpl}),prompt,enabled:env.WHOSPOST_AI_ENABLED==='1',configured:!!env.GEMINI_API_KEY,maxOutputTokens:number(env.WHOSPOST_AI_MAX_OUTPUT_TOKENS,1800),now,
   // Generation runs from the alarm so it survives the request that queued it.
   schedule:()=>{ctx.storage.setAlarm(now());}});
 }
 requestScan(username,profile,options){return this.store.requestScan(username,profile,options);}
 scanView(id){return this.store.scanView(id);}
 budgetSummary(){return this.store.budgetSummary();}
 dailySummary(){return this.store.dailySummary();}
 get(id){return this.store.get(id);}
 update(id,patch){return this.store.update(id,patch);}
 getState(id){return this.store.getState(id);}
 setState(id,state){return this.store.setState(id,state);}
 comparison(username,targets){return this.store.comparison(username,targets);}
 saveEvidence(id,rows){return this.store.saveEvidence(id,rows);}
 saveAnalysis(id,result){return this.store.saveAnalysis(id,result);}
 cacheSet(key,value){return this.store.cacheSet(key,value);}
 // RPC does not carry custom error fields, so budget refusals come back as values.
 budgetReserve(key,amount){try{return {ok:true,...this.store.budget.reserve(key,amount)};}catch(e){return budgetError(e);}}
 budgetSettle(key,amount,options){try{this.store.budget.settle(key,amount,options);return {ok:true};}catch(e){return budgetError(e);}}
 aiStatus(){return this.service.capabilities();}
 aiInspect(id){const scan=this.store.get(id);return scan&&{account:scan.account.username,result:this.service.inspect(scan)};}
 aiRevalidate(id){const scan=this.store.get(id);return scan&&this.service.revalidate(scan);}
 aiDiagnose(id){const scan=this.store.get(id);return scan&&this.service.diagnose(scan);}
 aiStart(id,options={}){const scan=this.store.get(id);return scan&&{account:scan.account.username,result:this.service.start(scan,options)};}
 async alarm(){for(const key of this.ai.queuedKeys())await this.service.work(key).catch(()=>this.ai.fail(key,'indeterminate',Date.now()));}
 /** Admin recovery after a person has checked the Apify run list: drops dispatches that never got a run ID
  *  and releases their reservations, so the scan can be requested again. */
 releaseUnknownDispatch(id){
  return this.ctx.storage.transactionSync(()=>{
   if(!this.store.get(id))return null;
   const state=this.store.getState(id),released=[];
   for(const [key,job] of Object.entries(state.jobs??{}))if(job.dispatched&&!job.runId){if(job.reservedKey)this.store.budget.settle(job.reservedKey,0,{final:true});delete state.jobs[key];state.releases={...state.releases,[key]:(state.releases?.[key]??0)+1};released.push(key);}
   this.store.setState(id,state);
   return {scanId:id,released};
  });
 }
 requestLog(){return this.store.requestLog();}
 /** Admin list of every scan, newest first: account, status, signal count and the Apify spend booked under its ID. */
 adminScans(){
  const spend=new Map();
  for(const r of this.store.db.prepare('SELECT key,reserved,actual,final FROM budget').all()){const id=r.key.split(':')[0];spend.set(id,(spend.get(id)??0)+(r.final?r.actual??0:Math.max(r.actual??0,r.reserved)));}
  return this.store.db.prepare('SELECT id,result_json FROM scans ORDER BY created_at DESC').all().map(({id,result_json})=>{
   const scan=JSON.parse(result_json);
   return {id,username:scan.account?.username??null,status:scan.status,createdAt:scan.createdAt??null,completedAt:scan.completedAt??null,
    errorCode:scan.error?.code??null,posts:scan.posts?.length??0,comments:scan.comments?.length??0,
    signals:scan.status==='completed'?signalScore(scan).value:null,apifyUsd:Number((spend.get(id)??0).toFixed(6))};
  });
 }
 /** Admin seed: copies saved scans and AI results; never imports spend ledgers. */
 importSeed(seed){
  const db=this.store.db,insert=(table,rows,columns)=>{const stmt=db.prepare(`INSERT OR IGNORE INTO ${table}(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`);for(const r of rows??[])stmt.run(...columns.map(c=>r[c]??null));return rows?.length??0;};
  return this.ctx.storage.transactionSync(()=>({
   scans:insert('scans',seed.scans,['id','username','status','created_at','updated_at','result_json','provider_state_json']),
   observations:insert('observations',seed.observations,['scan_id','author','content_id','observed_at','source','evidence_json']),
   evidence:insert('evidence',seed.evidence,['id','author','kind','text','posted_at','url','parent_url','fetched_at','source','scan_id','is_quote','is_repost']),
   analysisRuns:insert('analysis_runs',seed.analysis_runs,['run_id','scan_id','version','analyzed_at','result_json']),
   aiJobs:insert('ai_jobs',seed.ai_jobs,['key','status','plan','updated','error','raw','projection','usage','actual_model'])
  }));
 }
}
/** Store interface for runScan backed by the data Durable Object stub. */
export function remoteStore(stub){
 const rethrow=r=>{if(!r.ok)throw Object.assign(new Error(r.message),{code:r.code});return r;};
 return {
  get:id=>stub.get(id),update:(id,patch)=>stub.update(id,patch),getState:id=>stub.getState(id),setState:(id,state)=>stub.setState(id,state),
  comparison:(u,t)=>stub.comparison(u,t),saveEvidence:(id,rows)=>stub.saveEvidence(id,rows),saveAnalysis:(id,r)=>stub.saveAnalysis(id,r),cacheSet:(k,v)=>stub.cacheSet(k,v),
  budget:{reserve:async(key,amount)=>rethrow(await stub.budgetReserve(key,amount)),settle:async(key,amount,options)=>{rethrow(await stub.budgetSettle(key,amount,options));}}
 };
}
