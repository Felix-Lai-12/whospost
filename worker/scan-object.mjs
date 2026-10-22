import {runScan,SCAN_ERROR_MESSAGES} from '../server/scan-runner.mjs';
import {remoteStore} from './store-object.mjs';
import {log as structured} from './log.mjs';
// Workers Free allows 50 external subrequests per invocation, so one alarm polls Apify a bounded number of
// times and the next alarm resumes the same runs. Saved run IDs make every resume free of new charges.
// Each poll is a long poll that Apify answers when the run finishes, or after WAIT_S seconds. Posts and replies
// poll together: with cross-account search off, one alarm makes at most 2×(start + 4 polls + dataset) + 3 Cofacts
// lookups = 15 external calls, and it waits about 5 minutes at most (4 polls with 15 s of timeout slack each),
// inside the 15-minute alarm limit. MAX_RESUMES keeps the total wait at about 24 minutes, as before.
// Bills settle after the scan ends, in later alarms that read each finished run once: one call per Apify job.
const WAIT_S=60,POLLS_PER_ALARM=4,RESUME_MS=3000,MAX_RESUMES=6,MAX_ERRORS=5,SETTLE_MS=5000;
const log=(event,fields)=>structured('info',event,fields);
/**
 * One Durable Object per scan, driven by its alarm. The handler is idempotent (a scan that is no longer
 * queued or running is not fetched again) and catches its own errors so a broken run is retried with
 * backoff and finally marked failed, instead of exhausting the platform's six alarm retries.
 * Once the scan has ended (completed or failed) and AI has started, the same object settles its Apify bills:
 * every SETTLE_MS one alarm reads each finished run once until its bill is final, so no result waits for them.
 */
export class ScanJobCore{
 constructor(ctx,env,{storeStub,fetchAccount,settleBills,precheck=null,now=Date.now}){Object.assign(this,{ctx,env,storeStub,fetchAccount,settleBills,precheck,now});}
 async start(id){
  // A failed scan requested again while its bills settle stops settling and runs now with fresh counters; its bills
  // settle after it ends. Only storage calls run here, so a settle pass in flight sees the change before it finishes.
  if(await this.ctx.storage.get('scanId')){if(await this.ctx.storage.get('settling')){await this.ctx.storage.delete('settling');await this.ctx.storage.put({resumes:0,errors:0});await this.ctx.storage.setAlarm(this.now());}return;}
  await this.ctx.storage.put({scanId:id,resumes:0,errors:0});await this.ctx.storage.setAlarm(this.now());
 }
 async alarm(){
  const id=await this.ctx.storage.get('scanId');if(!id)return;
  const store=remoteStore(this.storeStub),env=this.env,finish=async()=>{await this.ctx.storage.delete(['scanId','resumes','errors','settling']);};
  // The result is out, so the bills settle from the next alarm on; errors get a fresh retry budget for that.
  const settleLater=async result=>{await this.ctx.storage.put({settling:true,errors:0});await this.ctx.storage.setAlarm(this.now()+SETTLE_MS);return result;};
  try{
   const scan=await store.get(id);
   if(!scan){await finish();return {status:'missing'};}
   const settling=await this.ctx.storage.get('settling');
   if(!['queued','running'].includes(scan.status)){
    if(settling)return await this.settle(id,store,finish);
    if(scan.status==='completed')await this.storeStub.aiStart(id,{});
    return await settleLater({status:scan.status});
   }
   // Queued again without start() clearing the flag: run it first, as start() would.
   if(settling){await this.ctx.storage.delete('settling');await this.ctx.storage.put({resumes:0,errors:0});}
   // The free account check logs its answer and time only; the account name stays out of logs.
   const precheck=this.precheck&&(async username=>{const verdict=await this.precheck(username);log('scan.precheck',{scanId:id,status:verdict.status,durationMs:verdict.ms});return verdict;});
   const result=await runScan(id,{store,resumable:true,precheck,crossAccountSearch:env.WHOSPOST_CROSS_ACCOUNT_SEARCH==='1',onAnalyzed:s=>this.storeStub.aiStartScan(s,{}),
    fetchAccount:(username,options)=>this.fetchAccount(username,{...options,token:env.APIFY_TOKEN,waitSecs:WAIT_S,maxPolls:POLLS_PER_ALARM})});
   if(result.status==='pending'){
    const resumes=((await this.ctx.storage.get('resumes'))??0)+1;await this.ctx.storage.put('resumes',resumes);
    if(resumes<=MAX_RESUMES){await this.ctx.storage.setAlarm(this.now()+RESUME_MS);return result;}
    const message=SCAN_ERROR_MESSAGES.APIFY_PENDING;
    await store.update(id,{status:'failed',partial:null,progress:message,completedAt:new Date(this.now()).toISOString(),error:{code:'APIFY_PENDING',message}});
    structured('warn','scan.failed',{scanId:id,status:'failed',code:'APIFY_PENDING',resumes});return await settleLater({status:'failed',code:'APIFY_PENDING'});
   }
   // AI judgement is generated once per account and evidence, then shared by every viewer. runScan already started
   // it from the analysed scan; this call is a no-op then, and starts it if that early start failed.
   // runScan already logged scan.completed or scan.failed.
   if(result.status==='completed')await this.storeStub.aiStart(id,{});
   return await settleLater(result);
  }catch(e){
   const errors=((await this.ctx.storage.get('errors'))??0)+1;await this.ctx.storage.put('errors',errors);
   structured('error','do.error',{object:'ScanJob',method:'alarm',scanId:id,attempt:errors,error:e});
   if(errors<=MAX_ERRORS){await this.ctx.storage.setAlarm(this.now()+Math.min(60000,2000*2**errors));return {status:'retrying'};}
   // Settling never changes the scan result. A reservation it could not confirm keeps counting at its cap.
   if(await this.ctx.storage.get('settling')){structured('warn','apify.settle_abandoned',{scanId:id,attempt:errors});await finish();return {status:'unsettled'};}
   const message=SCAN_ERROR_MESSAGES.PROVIDER_FAILED;
   try{await store.update(id,{status:'failed',partial:null,progress:message,completedAt:new Date(this.now()).toISOString(),error:{code:'PROVIDER_FAILED',message}});}catch{}
   await finish();return {status:'failed',code:'PROVIDER_FAILED'};
  }
 }
 /** One settlement pass: each finished run's bill is read once, and another alarm follows while any bill is not final. */
 async settle(id,store,finish){
  const pending=await this.settleBills(await store.getState(id),{token:this.env.APIFY_TOKEN,budget:store.budget,onState:s=>store.setState(id,s)});
  // start() cleared the flag because the scan was requested again during this pass: that run goes first.
  if(!await this.ctx.storage.get('settling'))return {status:'requeued'};
  if(pending){await this.ctx.storage.setAlarm(this.now()+SETTLE_MS);return {status:'settling'};}
  await finish();return {status:'settled'};
 }
}
