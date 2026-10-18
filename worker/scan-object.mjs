import {runScan} from '../server/scan-runner.mjs';
import {remoteStore} from './store-object.mjs';
const RETRY_MS=30000,MAX_RESUMES=20;
/**
 * One Durable Object per scan. The alarm runs the scan; saved provider jobs make every run resumable,
 * so an evicted or retried alarm continues the same Apify runs instead of paying for new ones.
 */
export class ScanJobCore{
 constructor(ctx,env,{storeStub,fetchAccount,now=Date.now}){Object.assign(this,{ctx,env,storeStub,fetchAccount,now});}
 async start(id){if(await this.ctx.storage.get('scanId'))return;await this.ctx.storage.put({scanId:id,resumes:0});await this.ctx.storage.setAlarm(this.now());}
 async alarm(){
  const id=await this.ctx.storage.get('scanId');if(!id)return;
  const store=remoteStore(this.storeStub),env=this.env;
  const result=await runScan(id,{store,crossAccountSearch:env.WHOSPOST_CROSS_ACCOUNT_SEARCH==='1',fetchAccount:(username,options)=>this.fetchAccount(username,{...options,token:env.APIFY_TOKEN})});
  if(result.status==='failed'&&result.code==='APIFY_PENDING'){
   const resumes=(await this.ctx.storage.get('resumes'))+1;await this.ctx.storage.put('resumes',resumes);
   if(resumes<=MAX_RESUMES){await store.update(id,{status:'running',error:null,progress:'Apify 任務仍在處理，稍後自動繼續'});await this.ctx.storage.setAlarm(this.now()+RETRY_MS);}
   return result;
  }
  // AI judgement is generated once per account and evidence, then shared by every viewer.
  if(result.status==='completed')await this.storeStub.aiStart(id,{});
  await this.ctx.storage.delete('scanId');
  return result;
 }
}
