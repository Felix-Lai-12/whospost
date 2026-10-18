const API = 'https://api.apify.com/v2';
const TERMINAL = new Set(['SUCCEEDED','FAILED','TIMED-OUT','ABORTED']);
export class ProviderError extends Error { constructor(code,message,status){super(message);this.code=code;if(status!==undefined)this.status=status;} }
export function createApifyRunner({token = process.env.APIFY_TOKEN, fetchImpl = globalThis.fetch, sleep = ms=>new Promise(r=>setTimeout(r,ms)), onState=async()=>{}, state={}, budget, pollMs=2500, maxPolls=80, settlePollMs=5000, settleChecks=6}) {
  let current = structuredClone(state); current.jobs ||= {};
  const persist = async (key,patch) => { current.jobs[key]={...current.jobs[key],...patch}; await onState(structuredClone(current)); };
  // Workers reject redirect:'error'; with 'manual' a redirect is a non-2xx response and is refused below.
  async function request(path, init={}) {
    let response;
    try { response = await fetchImpl(`${API}${path}`,{...init,headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},signal:AbortSignal.timeout(30000),redirect:'manual'}); }
    catch { throw new ProviderError('APIFY_NETWORK','Apify 網路回應未完成；已保留工作狀態，避免重複啟動。'); }
    if (!response.ok) throw new ProviderError(response.status===401?'APIFY_AUTH':'APIFY_HTTP',`Apify 回傳 HTTP ${response.status}，未自動重送付費工作。`,response.status);
    try { return await response.json(); } catch { throw new ProviderError('APIFY_FORMAT','Apify 回應格式無法解析。'); }
  }
  // Pay-per-event charges keep landing after SUCCEEDED. A bill is final only when two later reads agree
  // and any per-dataset-item event already covers the rows we received.
  async function finalUsage(run,rowCount) {
    let prev=null;
    for (let i=0;i<settleChecks;i++) {
      await sleep(settlePollMs);
      let next;
      try { next=(await request(`/actor-runs/${encodeURIComponent(run.id)}`)).data; } catch { break; }
      const items=Object.entries(next?.chargedEventCounts??{}).find(([k])=>k.includes('dataset-item'))?.[1];
      const covered=rowCount===null||items===undefined||items>=rowCount;
      if (prev&&next?.usageTotalUsd===prev.usageTotalUsd&&JSON.stringify(next?.chargedEventCounts??null)===JSON.stringify(prev.chargedEventCounts??null)&&covered) return {usage:next.usageTotalUsd,final:true};
      prev=next;
    }
    return {usage:(prev??run)?.usageTotalUsd,final:false};
  }
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
          await onState(structuredClone(current));
        }
        throw e;
      }
      run=result.data;
      if (!run?.id) throw new ProviderError('APIFY_FORMAT','啟動回應沒有工作編號，未自動重送。');
      await persist(key,{runId:run.id,status:run.status,datasetId:run.defaultDatasetId});
    } else { run=(await request(`/actor-runs/${encodeURIComponent(job.runId)}`)).data; }
    let polls=0;
    while (!TERMINAL.has(run?.status)) {
      if (++polls>maxPolls) throw new ProviderError('APIFY_PENDING','Apify 工作尚未結束；保留工作編號供恢復。');
      await sleep(pollMs);
      run=(await request(`/actor-runs/${encodeURIComponent(run.id)}`)).data;
      await persist(key,{status:run?.status,datasetId:run?.defaultDatasetId});
    }
    let rows=null,rowsError=null;
    if(run.status==='SUCCEEDED'&&run.defaultDatasetId){try{rows=await request(`/datasets/${encodeURIComponent(run.defaultDatasetId)}/items?clean=true&format=json&limit=250`);}catch(e){rowsError=e;}}
    // A resumed job whose bill was already confirmed final is not re-read or settled again.
    const settled=job?.usageFinal===true&&Number.isFinite(job.usageTotalUsd);
    const bill=settled?{usage:job.usageTotalUsd,final:true}:await finalUsage(run,Array.isArray(rows)?rows.length:null);
    await persist(key,{status:run.status,datasetId:run.defaultDatasetId,usageTotalUsd:bill.usage ?? null,usageFinal:bill.final});
    if (!settled&&typeof bill.usage==='number'&&Number.isFinite(bill.usage)&&bill.usage>=0) await budget.settle(current.jobs[key].reservedKey || budgetKey,bill.usage,{final:bill.final});
    if(run.status!=='SUCCEEDED') throw new ProviderError('APIFY_RUN_FAILED',`Apify 工作 ${run.status}；本項資料未完成。`);
    if(!run.defaultDatasetId) throw new ProviderError('APIFY_FORMAT','Apify 沒有回傳資料集。');
    if(rowsError) throw rowsError;
    if(!Array.isArray(rows))throw new ProviderError('APIFY_FORMAT','Apify 資料集格式無法解析。');
    return rows;
  };
}
