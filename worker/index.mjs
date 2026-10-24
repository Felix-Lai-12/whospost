import {DurableObject} from 'cloudflare:workers';
import puppeteer from '@cloudflare/puppeteer';
import accountBehaviorPrompt from '../prompts/account-behavior.md';
import {fetchAccount,settleBills} from '../server/providers/index.mjs';
import {checkThreadsProfile} from '../server/providers/threads-profile.mjs';
import {createWorkerApp} from './app.mjs';
import {StoreObjectCore} from './store-object.mjs';
import {ScanJobCore} from './scan-object.mjs';
import {fetchProviderOptions} from './fetch-provider.mjs';
import {OgImageCore} from './og-object.mjs';
import {renderCard} from './og-render.mjs';
import {log,requestLogger} from './log.mjs';
import {runBackup} from './backup.mjs';
// One data object for the whole site, placed near Taiwan on first use.
const dataStub=env=>env.STORE.get(env.STORE.idFromName('main'),{locationHint:'apac'});
// Preview-card renderer, separate from the data object so a render never holds up scans.
const ogStub=env=>env.OG_IMAGE?.get(env.OG_IMAGE.idFromName('main'),{locationHint:'apac'});
export class WhospostStore extends DurableObject{
 constructor(ctx,env){super(ctx,env);this.core=new StoreObjectCore(ctx,env,{prompt:accountBehaviorPrompt});}
 requestScan(...a){return this.core.requestScan(...a);}
 wouldStart(...a){return this.core.wouldStart(...a);}
 scanView(id){return this.core.scanView(id);}
 budgetSummary(){return this.core.budgetSummary();}
 dailySummary(){return this.core.dailySummary();}
 browserSummary(){return this.core.browserSummary();}
 pledge(h){return this.core.pledge(h);}
 pledgeCount(){return this.core.pledgeCount();}
 get(id){return this.core.get(id);}
 update(id,patch){return this.core.update(id,patch);}
 getState(id){return this.core.getState(id);}
 setState(id,state){return this.core.setState(id,state);}
 comparison(u,t){return this.core.comparison(u,t);}
 saveEvidence(id,rows){return this.core.saveEvidence(id,rows);}
 saveAnalysis(id,r){return this.core.saveAnalysis(id,r);}
 cacheSet(k,v,ttl){return this.core.cacheSet(k,v,ttl);}
 cacheGet(k){return this.core.cacheGet(k);}
 budgetReserve(k,a){return this.core.budgetReserve(k,a);}
 budgetSettle(k,a,o){return this.core.budgetSettle(k,a,o);}
 aiStatus(){return this.core.aiStatus();}
 aiInspect(id){return this.core.aiInspect(id);}
 aiStart(id,o){return this.core.aiStart(id,o);}
 aiStartScan(s,o){return this.core.aiStartScan(s,o);}
 aiDiagnose(id){return this.core.aiDiagnose(id);}
 aiRevalidate(id){return this.core.aiRevalidate(id);}
 importSeed(seed){return this.core.importSeed(seed);}
 releaseUnknownDispatch(id){return this.core.releaseUnknownDispatch(id);}
 adminScans(){return this.core.adminScans();}
 requestLog(){return this.core.requestLog();}
 listEntries(){return this.core.listEntries();}
 appeal(body){return this.core.appeal(body);}
 telemetry(body){return this.core.telemetry(body);}
 telemetrySummary(days){return this.core.telemetrySummary(days);}
 exportPage(t,a,l){return this.core.exportPage(t,a,l);}
 failEmptyScans(){return this.core.failEmptyScans();}
 alarm(){return this.core.alarm().catch(e=>{log('error','do.error',{object:'WhospostStore',method:'alarm',error:e});throw e;});}
}
export class ScanJob extends DurableObject{
 // The provider vars pick the fetcher per scan: the browser fetcher opens a Browser Rendering session through env.BROWSER.
 constructor(ctx,env){super(ctx,env);const providers=fetchProviderOptions(env,{launch:()=>puppeteer.launch(env.BROWSER)});this.core=new ScanJobCore(ctx,env,{storeStub:dataStub(env),fetchAccount:(username,options)=>fetchAccount(username,{...options,...providers.fetchOptions()}),settleBills,precheck:checkThreadsProfile});}
 start(id){return this.core.start(id);}
 alarm(){return this.core.alarm();}
}
export class OgImage extends DurableObject{
 constructor(ctx,env){super(ctx,env);this.core=new OgImageCore(ctx,{render:renderCard});}
 png(id,card){return this.core.png(id,card).catch(e=>{log('error','do.error',{object:'OgImage',method:'png',scanId:id,error:e});throw e;});}
}
// Every API request and the page get one 'request' log line (method, path pattern, status, durationMs); a handler
// that throws is logged and answered with a 500 instead of a Workers error page.
export default {
 fetch:requestLogger((request,env,ctx)=>createWorkerApp(env,{storeStub:dataStub(env),ogStub:ogStub(env),startScan:id=>env.SCAN_JOB.get(env.SCAN_JOB.idFromName(id)).start(id),waitUntil:p=>ctx.waitUntil(p),backup:()=>runBackup({storeStub:dataStub(env),bucket:env.BACKUPS})})(request)),
 // Nightly cron (wrangler.jsonc triggers): copy every table to R2 and drop backups older than the retention window.
 scheduled(event,env,ctx){
  ctx.waitUntil(runBackup({storeStub:dataStub(env),bucket:env.BACKUPS,now:()=>event.scheduledTime}).then(m=>log('info','backup.done',{date:m.date,rows:m.rows,deleted:m.deleted}),e=>{log('error','backup.failed',{error:e});throw e;}));
 }
};
