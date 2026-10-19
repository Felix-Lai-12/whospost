import {runScan,SCAN_ERROR_MESSAGES} from '../server/scan-runner.mjs';
import {remoteStore} from './store-object.mjs';
// Workers Free allows 50 external subrequests per invocation, so one alarm polls Apify a bounded number of
// times and the next alarm resumes the same runs. Saved run IDs make every resume free of new charges.
// Posts and replies poll together: with cross-account search off, one alarm makes at most
// 2×(start + 8 polls + dataset + 6 bill checks) + 3 Cofacts lookups = 35 external calls.
const POLL_MS=3000,POLLS_PER_ALARM=8,RESUME_MS=3000,MAX_RESUMES=60,MAX_ERRORS=5;
const log=(message,fields)=>console.log(JSON.stringify({message,...fields}));
/**
 * One Durable Object per scan, driven by its alarm. The handler is idempotent (a scan that is no longer
 * queued or running is not fetched again) and catches its own errors so a broken run is retried with
 * backoff and finally marked failed, instead of exhausting the platform's six alarm retries.
 */
export class ScanJobCore{
 constructor(ctx,env,{storeStub,fetchAccount,now=Date.now}){Object.assign(this,{ctx,env,storeStub,fetchAccount,now});}
 async start(id){if(await this.ctx.storage.get('scanId'))return;await this.ctx.storage.put({scanId:id,resumes:0,errors:0});await this.ctx.storage.setAlarm(this.now());}
 async alarm(){
  const id=await this.ctx.storage.get('scanId');if(!id)return;
  const store=remoteStore(this.storeStub),env=this.env,finish=async()=>{await this.ctx.storage.delete(['scanId','resumes','errors']);};
  try{
   const scan=await store.get(id);
   if(!scan||!['queued','running'].includes(scan.status)){if(scan?.status==='completed')await this.storeStub.aiStart(id,{});await finish();return {status:scan?.status??'missing'};}
   const result=await runScan(id,{store,resumable:true,crossAccountSearch:env.WHOSPOST_CROSS_ACCOUNT_SEARCH==='1',
    fetchAccount:(username,options)=>this.fetchAccount(username,{...options,token:env.APIFY_TOKEN,pollMs:POLL_MS,maxPolls:POLLS_PER_ALARM})});
   if(result.status==='pending'){
    const resumes=((await this.ctx.storage.get('resumes'))??0)+1;await this.ctx.storage.put('resumes',resumes);
    if(resumes<=MAX_RESUMES){await this.ctx.storage.setAlarm(this.now()+RESUME_MS);return result;}
    const message=SCAN_ERROR_MESSAGES.APIFY_PENDING;
    await store.update(id,{status:'failed',progress:message,completedAt:new Date(this.now()).toISOString(),error:{code:'APIFY_PENDING',message}});
    log('scan gave up waiting for Apify',{scanId:id,resumes});await finish();return {status:'failed',code:'APIFY_PENDING'};
   }
   // AI judgement is generated once per account and evidence, then shared by every viewer.
   if(result.status==='completed')await this.storeStub.aiStart(id,{});
   else log('scan failed',{scanId:id,code:result.code,cause:result.cause});
   await finish();return result;
  }catch(e){
   const errors=((await this.ctx.storage.get('errors'))??0)+1;await this.ctx.storage.put('errors',errors);
   console.error(JSON.stringify({message:'scan alarm error',scanId:id,attempt:errors,error:String(e?.message??e)}));
   if(errors<=MAX_ERRORS){await this.ctx.storage.setAlarm(this.now()+Math.min(60000,2000*2**errors));return {status:'retrying'};}
   const message=SCAN_ERROR_MESSAGES.PROVIDER_FAILED;
   try{await store.update(id,{status:'failed',progress:message,completedAt:new Date(this.now()).toISOString(),error:{code:'PROVIDER_FAILED',message}});}catch{}
   await finish();return {status:'failed',code:'PROVIDER_FAILED'};
  }
 }
}
