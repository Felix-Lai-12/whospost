import {parseAccount} from './parse-account.mjs';
// Fetch-API request handler shared by the Node server (server/http.mjs) and the Worker (worker/app.mjs).
// Returns a Response for /api/* and null for everything else (static files).
const json=(status,value,headers={})=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
const AI_STATUS={processing:202,ready:200,no_data:409,scan_not_ready:409,disabled:503,not_configured:503,budget_exceeded:429,invalid_output:422,preflight_failed:503,indeterminate:409,response_too_large:413};
const AI_DISABLED={status:'disabled',message:'AI 自動判讀尚未啟用。',result:null};
async function readText(request,limit){const text=await request.text();return new TextEncoder().encode(text).length>limit?null:text;}
/**
 * store: requestScan, scanView, budgetSummary (sync Store or async stub).
 * ai: {status(), inspect(id), start(id,options)} where inspect/start resolve to {account,result} or null.
 * gate(request, body): resolves {response} to deny, or {quota} for requestScan. Worker-only (Turnstile, rate limit).
 * allowAiStart=false turns POST /api/scans/:id/ai into a read, so the public cannot trigger paid AI work.
 */
export function createApi({store,ai=null,profile,configured=()=>true,startRun,estimateUsd=0,gate=null,healthExtra=()=>({}),allowAiStart=true}){
 return async function handle(request){
  const url=new URL(request.url);
  if(!url.pathname.startsWith('/api/'))return null;
  try{
   const method=request.method,origin=request.headers.get('origin'),foreign=origin&&origin!==url.origin;
   if(method==='GET'&&url.pathname==='/api/health')return json(200,{ok:true,apifyConfigured:configured(),budget:await store.budgetSummary(),...await healthExtra()});
   if(url.pathname==='/api/ai/status')return method==='GET'?json(200,ai?await ai.status():{enabled:false,configured:false,budget:null}):json(405,{error:'不支援的請求'});
   const aiMatch=url.pathname.match(/^\/api\/scans\/([\w-]+)\/ai$/);
   if(aiMatch){
    if(!['GET','POST'].includes(method))return json(405,{error:'不支援的請求'});
    let options={};
    if(method==='POST'){
     if(foreign)return json(403,{error:'不接受外部網站啟動 AI 判讀'});
     if(!request.headers.get('content-type')?.includes('application/json'))return json(415,{error:'需使用JSON'});
     const body=await readText(request,512);if(body===null)return json(413,{error:'輸入過長'});
     try{options=JSON.parse(body||'{}');if(!options||Array.isArray(options)||typeof options!=='object'||Object.keys(options).some(k=>k!=='retry')||(Object.hasOwn(options,'retry')&&typeof options.retry!=='boolean'))throw Error();}catch{return json(400,{error:'只接受可選的 retry 布林值'});}
    }
    const starting=method==='POST'&&allowAiStart;
    const found=ai?await (starting?ai.start(aiMatch[1],options):ai.inspect(aiMatch[1])):await store.scanView(aiMatch[1]).then(s=>s&&{account:s.account.username,result:AI_DISABLED});
    if(!found)return json(404,{error:'找不到查詢紀錄'});
    return json(starting?AI_STATUS[found.result.status]??200:200,{scanId:aiMatch[1],account:found.account,...found.result});
   }
   if(method==='POST'&&url.pathname==='/api/scans'){
    if(foreign)return json(403,{error:'不接受外部網站啟動查詢'});
    if(!request.headers.get('content-type')?.includes('application/json'))return json(415,{error:'需使用JSON'});
    const text=await request.text();if(text.length>2048)return json(413,{error:'輸入過長'});
    let body,username;try{body=JSON.parse(text);username=parseAccount(body.url);}catch(e){return json(400,{error:e.message});}
    let quota=null;
    if(gate){const g=await gate(request,body);if(g.response)return g.response;quota=g.quota??null;}
    const decision=await store.requestScan(username,profile,{configured:configured(),quota,estimateUsd});
    if(decision.run)await startRun(decision.run);
    return json(decision.status,decision.body);
   }
   if(method==='GET'&&/^\/api\/scans\/[\w-]+$/.test(url.pathname)){const view=await store.scanView(url.pathname.split('/').pop());return json(view?200:404,view??{error:'找不到查詢紀錄'});}
   return json(404,{error:'找不到API'});
  }catch{return json(500,{error:'服務暫時無法回應'});}
 };
}
export {json};
