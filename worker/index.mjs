import {DurableObject} from 'cloudflare:workers';
import accountBehaviorPrompt from '../prompts/account-behavior.md';
import {fetchAccount,settleBills} from '../server/providers/index.mjs';
import {createWorkerApp} from './app.mjs';
import {StoreObjectCore} from './store-object.mjs';
import {ScanJobCore} from './scan-object.mjs';
import {OgImageCore} from './og-object.mjs';
import {renderCard} from './og-render.mjs';
// One data object for the whole site, placed near Taiwan on first use.
const dataStub=env=>env.STORE.get(env.STORE.idFromName('main'),{locationHint:'apac'});
// Preview-card renderer, separate from the data object so a render never holds up scans.
const ogStub=env=>env.OG_IMAGE?.get(env.OG_IMAGE.idFromName('main'),{locationHint:'apac'});
export class WhospostStore extends DurableObject{
 constructor(ctx,env){super(ctx,env);this.core=new StoreObjectCore(ctx,env,{prompt:accountBehaviorPrompt});}
 requestScan(...a){return this.core.requestScan(...a);}
 scanView(id){return this.core.scanView(id);}
 budgetSummary(){return this.core.budgetSummary();}
 dailySummary(){return this.core.dailySummary();}
 get(id){return this.core.get(id);}
 update(id,patch){return this.core.update(id,patch);}
 getState(id){return this.core.getState(id);}
 setState(id,state){return this.core.setState(id,state);}
 comparison(u,t){return this.core.comparison(u,t);}
 saveEvidence(id,rows){return this.core.saveEvidence(id,rows);}
 saveAnalysis(id,r){return this.core.saveAnalysis(id,r);}
 cacheSet(k,v){return this.core.cacheSet(k,v);}
 budgetReserve(k,a){return this.core.budgetReserve(k,a);}
 budgetSettle(k,a,o){return this.core.budgetSettle(k,a,o);}
 aiStatus(){return this.core.aiStatus();}
 aiInspect(id){return this.core.aiInspect(id);}
 aiStart(id,o){return this.core.aiStart(id,o);}
 aiDiagnose(id){return this.core.aiDiagnose(id);}
 aiRevalidate(id){return this.core.aiRevalidate(id);}
 importSeed(seed){return this.core.importSeed(seed);}
 releaseUnknownDispatch(id){return this.core.releaseUnknownDispatch(id);}
 adminScans(){return this.core.adminScans();}
 requestLog(){return this.core.requestLog();}
 alarm(){return this.core.alarm();}
}
export class ScanJob extends DurableObject{
 constructor(ctx,env){super(ctx,env);this.core=new ScanJobCore(ctx,env,{storeStub:dataStub(env),fetchAccount,settleBills});}
 start(id){return this.core.start(id);}
 alarm(){return this.core.alarm();}
}
export class OgImage extends DurableObject{
 constructor(ctx,env){super(ctx,env);this.core=new OgImageCore(ctx,{render:renderCard});}
 png(id,card){return this.core.png(id,card);}
}
export default {
 fetch(request,env){
  return createWorkerApp(env,{storeStub:dataStub(env),ogStub:ogStub(env),startScan:id=>env.SCAN_JOB.get(env.SCAN_JOB.idFromName(id)).start(id)})(request);
 }
};
