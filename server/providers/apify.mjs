const API = 'https://api.apify.com/v2';
const TERMINAL = new Set(['SUCCEEDED','FAILED','TIMED-OUT','ABORTED']);
export class ProviderError extends Error { constructor(code,message,status){super(message);this.code=code;if(status!==undefined)this.status=status;} }
// Workers reject redirect:'error'; with 'manual' a redirect is a non-2xx response and is refused below.
const apifyRequest=(token,fetchImpl)=>async function request(path, init={}, timeoutMs=30000) {
  let response;
  try { response = await fetchImpl(`${API}${path}`,{...init,headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},signal:AbortSignal.timeout(timeoutMs),redirect:'manual'}); }
  catch { throw new ProviderError('APIFY_NETWORK','Apify 網路回應未完成；已保留工作狀態，避免重複啟動。'); }
  if (!response.ok) throw new ProviderError(response.status===401?'APIFY_AUTH':'APIFY_HTTP',`Apify 回傳 HTTP ${response.status}，未自動重送付費工作。`,response.status);
  try { return await response.json(); } catch { throw new ProviderError('APIFY_FORMAT','Apify 回應格式無法解析。'); }
};
// Jobs can run concurrently, so state writes are queued: an older snapshot never lands after a newer one.
function stateWriter(state,onState) {
  const current=structuredClone(state??{}); current.jobs ||= {};
  let saving=Promise.resolve();
  const save=()=>{ const snapshot=structuredClone(current), write=saving.then(()=>onState(snapshot)); saving=write.catch(()=>{}); return write; };
  const persist=async(key,patch)=>{ current.jobs[key]={...current.jobs[key],...patch}; await save(); };
  return {current,save,persist};
}
// Pay-per-event charges keep landing after SUCCEEDED, so a run's bill is confirmed after its rows went back,
// off the scan's critical path. Each pass reads every finished, unsettled run once; callers wait between passes.
// A bill is final only when two reads agree and any per-dataset-item event covers the rows we returned. Usage only
// grows, so two equal reads mean nothing landed between them. Until then the reservation counts at its cap, and
// after settleChecks reads the last bill is booked as provisional, which still counts at the cap.
const unsettled=(job,settleChecks)=>Boolean(job?.runId&&job.reservedKey&&TERMINAL.has(job.status)&&job.rowCount!==undefined&&job.usageFinal!==true&&(job.billChecks??0)<settleChecks);
/** One settlement pass over a scan's provider state. Returns true while a bill still needs a later read. */
export async function settleBills(state,{token=process.env.APIFY_TOKEN,fetchImpl=globalThis.fetch,onState=async()=>{},budget,settleChecks=6}={}) {
  if (!budget?.settle) throw new ProviderError('BUDGET_REQUIRED','缺少持久化費用限制。');
  const {current,persist}=stateWriter(state,onState),request=apifyRequest(token,fetchImpl);
  await Promise.all(Object.entries(current.jobs).filter(([,job])=>unsettled(job,settleChecks)).map(async ([key,job])=>{
    let read=null;
    try { const run=(await request(`/actor-runs/${encodeURIComponent(job.runId)}`)).data; if(Number.isFinite(run?.usageTotalUsd)&&run.usageTotalUsd>=0)read={usage:run.usageTotalUsd,counts:run.chargedEventCounts??null}; } catch {}
    const items=Object.entries(read?.counts??{}).find(([k])=>k.includes('dataset-item'))?.[1];
    const covered=job.rowCount===null||items===undefined||items>=job.rowCount;
    const final=Boolean(read&&job.bill&&read.usage===job.bill.usage&&JSON.stringify(read.counts)===JSON.stringify(job.bill.counts)&&covered);
    const bill=read??job.bill??null,billChecks=(job.billChecks??0)+1;
    if (!final&&billChecks<settleChecks) return persist(key,{bill,billChecks});
    // The state is saved before the ledger: a crash between them leaves the reservation at its cap and never settles twice.
    await persist(key,{bill,billChecks,usageTotalUsd:bill?.usage??null,usageFinal:final});
    if (bill) await budget.settle(job.reservedKey,bill.usage,{final});
  }));
  return Object.values(current.jobs).some(job=>unsettled(job,settleChecks));
}
/** For a host that waits in one process (the Node server, scripts): settle passes every settlePollMs until none is pending.
 *  The Worker spreads the same passes over alarms instead. */
export async function waitAndSettleBills(getState,{sleep=ms=>new Promise(r=>setTimeout(r,ms)),settlePollMs=5000,...options}={}) {
  for (let pending=true;pending;) { await sleep(settlePollMs); pending=await settleBills(await getState(),options); }
}
// Polls are long polls: Apify answers as soon as the run finishes, or after waitSecs (at most 60) with its status so far.
// Four of them outlast the 180 s run timeout. A poll's request timeout leaves 15 s beyond the wait.
export function createApifyRunner({token = process.env.APIFY_TOKEN, fetchImpl = globalThis.fetch, onState=async()=>{}, state={}, budget, waitSecs=60, maxPolls=4}) {
  const {current,save,persist}=stateWriter(state,onState),request=apifyRequest(token,fetchImpl);
  return async function run(key,actor,input,cap) {
    if (!token) throw new ProviderError('APIFY_TOKEN_MISSING','尚未設定伺服器端 APIFY_TOKEN。');
    if (!budget?.reserve || !budget?.settle) throw new ProviderError('BUDGET_REQUIRED','缺少持久化費用限制。');
    let job=current.jobs[key]; let run;
    if (job?.dispatched && !job.runId) throw new ProviderError('APIFY_UNKNOWN_RUN','上一個啟動請求結果不明，請先核對 Apify 工作紀錄；系統不重送。');
    // A released dispatch keeps its zero-cost ledger row; a retry reserves under a new key so it is counted again.
    const releases=current.releases?.[key]??0;
    const budgetKey=`${current.scanId || 'single-round'}:${key}${releases?`:retry${releases}`:''}`;
    if (!job?.runId) {
      await budget.reserve(budgetKey,cap);
      await persist(key,{dispatched:true,actor,cap,reservedKey:budgetKey,status:'DISPATCHING'});
      const query=new URLSearchParams({maxTotalChargeUsd:String(cap),timeout:'180',restartOnError:'false',waitForFinish:'0'});
      let result;
      try { result=await request(`/acts/${actor.replace('/','~')}/runs?${query}`,{method:'POST',body:JSON.stringify(input)}); }
      catch (e) {
        // Apify answers 4xx before it creates a run, so nothing started or was billed: release and allow a retry.
        // Network errors and 5xx stay reserved, since the run may exist.
        if (e.status>=400&&e.status<500) {
          await budget.settle(budgetKey,0,{final:true});
          delete current.jobs[key]; current.releases={...current.releases,[key]:releases+1};
          await save();
        }
        throw e;
      }
      run=result.data;
      if (!run?.id) throw new ProviderError('APIFY_FORMAT','啟動回應沒有工作編號，未自動重送。');
      await persist(key,{runId:run.id,status:run.status,datasetId:run.defaultDatasetId});
    }
    // A resumed job starts with a poll, which answers at once when the run has already finished.
    const runId=run?.id??job.runId;let polls=0;
    while (!TERMINAL.has(run?.status)) {
      if (++polls>maxPolls) throw new ProviderError('APIFY_PENDING','Apify 工作尚未結束；保留工作編號供恢復。');
      run=(await request(`/actor-runs/${encodeURIComponent(runId)}?waitForFinish=${waitSecs}`,{},(waitSecs+15)*1000)).data;
      await persist(key,{status:run?.status,datasetId:run?.defaultDatasetId});
    }
    let rows=null,rowsError=null;
    if(run.status==='SUCCEEDED'&&run.defaultDatasetId){try{rows=await request(`/datasets/${encodeURIComponent(run.defaultDatasetId)}/items?clean=true&format=json&limit=250`);}catch(e){rowsError=e;}}
    // The rows go back now and settleBills confirms the bill later. rowCount tells it which per-item charges to wait for.
    await persist(key,{status:run.status,datasetId:run.defaultDatasetId,rowCount:Array.isArray(rows)?rows.length:current.jobs[key].rowCount??null});
    if(run.status!=='SUCCEEDED') throw new ProviderError('APIFY_RUN_FAILED',`Apify 工作 ${run.status}；本項資料未完成。`);
    if(!run.defaultDatasetId) throw new ProviderError('APIFY_FORMAT','Apify 沒有回傳資料集。');
    if(rowsError) throw rowsError;
    if(!Array.isArray(rows))throw new ProviderError('APIFY_FORMAT','Apify 資料集格式無法解析。');
    return rows;
  };
}
