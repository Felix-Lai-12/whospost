// Read-only against Apify: confirms each open reservation's final bill and settles it, releasing the unused part.
// Never dispatches runs. Rows without a known run ID stay reserved.
import {Store} from '../server/store.mjs';
import {readSecret} from '../server/env-file.mjs';

export async function reconcileBudget(store,{fetchImpl=globalThis.fetch,token=process.env.APIFY_TOKEN,sleep=ms=>new Promise(r=>setTimeout(r,ms)),gapMs=5000}={}){
 const get=async path=>(await (await fetchImpl(`https://api.apify.com/v2${path}`,{headers:{Authorization:`Bearer ${token}`}})).json()).data;
 const jobs=new Map();
 for(const {id} of store.db.prepare('SELECT id FROM scans').all())for(const job of Object.values(store.getState(id).jobs??{}))if(job?.reservedKey&&job.runId)jobs.set(job.reservedKey,job);
 const report=[];
 for(const row of store.db.prepare('SELECT * FROM budget WHERE final=0').all()){
  const job=jobs.get(row.key);
  if(!job){report.push({key:row.key,status:'kept_reserved',reason:'no run ID'});continue;}
  const first=await get(`/actor-runs/${encodeURIComponent(job.runId)}`);await sleep(gapMs);const second=await get(`/actor-runs/${encodeURIComponent(job.runId)}`);
  const terminal=['SUCCEEDED','FAILED','TIMED-OUT','ABORTED'].includes(second?.status);
  const items=Object.entries(second?.chargedEventCounts??{}).find(([k])=>k.includes('dataset-item'))?.[1];
  const datasetItems=second?.defaultDatasetId&&items!==undefined?(await get(`/datasets/${encodeURIComponent(second.defaultDatasetId)}`))?.itemCount:undefined;
  const stable=first?.usageTotalUsd===second?.usageTotalUsd&&JSON.stringify(first?.chargedEventCounts??null)===JSON.stringify(second?.chargedEventCounts??null);
  const covered=items===undefined||datasetItems===undefined||items>=datasetItems;
  if(terminal&&stable&&covered&&Number.isFinite(second.usageTotalUsd)){store.budget.settle(row.key,second.usageTotalUsd,{final:true});report.push({key:row.key,status:'settled',reserved:row.reserved,before:row.actual,final:second.usageTotalUsd});}
  else report.push({key:row.key,status:'kept_reserved',reason:{terminal,stable,covered}});
 }
 return {report,summary:store.budget.summary()};
}

if(process.argv[1]&&import.meta.url===new URL(`file://${process.argv[1]}`).href){
 const [db]=process.argv.slice(2);
 if(!db)throw new Error('Usage: node scripts/reconcile-budget.mjs DATABASE');
 if(!process.env.APIFY_TOKEN)process.env.APIFY_TOKEN=readSecret('APIFY_TOKEN')??'';
 const store=new Store(db,{budgetLimitUsd:Number(process.env.WHOSPOST_APIFY_LIMIT_USD??1)});
 try{console.log(JSON.stringify(await reconcileBudget(store),null,1));}finally{store.close();}
}
