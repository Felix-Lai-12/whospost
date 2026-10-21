import {parseAccount} from './parse-account.mjs';
import {log,pathPattern} from '../worker/log.mjs';
// Fetch-API request handler shared by the Node server (server/http.mjs) and the Worker (worker/app.mjs).
// Returns a Response for /api/* and null for everything else (static files).
const json=(status,value,headers={})=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
const AI_STATUS={processing:202,ready:200,no_data:409,scan_not_ready:409,disabled:503,not_configured:503,budget_exceeded:429,invalid_output:422,preflight_failed:503,provider_rejected:503,indeterminate:409,response_too_large:413};
const PLEDGE_TOKEN=/^[a-f0-9]{32}$/,encoder=new TextEncoder();
const sha256Hex=async text=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(text)))].map(b=>b.toString(16).padStart(2,'0')).join('');
const AI_DISABLED={status:'disabled',message:'AI 自動判讀尚未啟用。',result:null};
// Reads at most `limit` bytes; never buffers an oversized or unbounded body. Returns null when too large.
async function readText(request,limit){
 const declared=Number(request.headers.get('content-length'));if(Number.isFinite(declared)&&declared>limit)return null;
 if(!request.body)return '';
 const reader=request.body.getReader(),chunks=[];let size=0;
 for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();return null;}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.byteLength;}
 return new TextDecoder().decode(bytes);
}
/**
 * store: requestScan, scanView, budgetSummary, pledge, pledgeCount (sync Store or async stub).
 * ai: {status(), inspect(id), start(id,options)} where inspect/start resolve to {account,result} or null.
 * pledgeGate(request): Worker-only; resolves {response} to deny POST /api/pledge (Worker proxy, per-IP rate limit).
 * gate(request, body): resolves {response} to deny, or {quota, paused?, refuse?} for requestScan; refuse is a {status, body}
 * answer for new paid work only (saved results are still served). Worker-only (Turnstile, rate limit, Apify account).
 * allowAiStart=false turns POST /api/scans/:id/ai into a read, so the public cannot trigger paid AI work.
 */
export function createApi({store,ai=null,profile,configured=()=>true,startRun,estimateUsd=0,gate=null,pledgeGate=null,healthExtra=()=>({}),allowAiStart=true}){
 return async function handle(request){
  const url=new URL(request.url);
  if(!url.pathname.startsWith('/api/'))return null;
  try{
   const method=request.method,origin=request.headers.get('origin'),foreign=origin&&origin!==url.origin;
   if(method==='GET'&&url.pathname==='/api/health')return json(200,{ok:true,configured:configured(),apifyConfigured:configured(),budget:await store.budgetSummary(),...await healthExtra()});
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
    const text=await readText(request,8192);if(text===null||text.length>2048)return json(413,{error:'輸入過長'});
    let body,username;try{body=JSON.parse(text);username=parseAccount(body.url);}catch(e){return json(400,{error:e.message});}
    let quota=null,paused=false,refuse=null;
    if(gate){const g=await gate(request,body);if(g.response)return g.response;quota=g.quota??null;paused=g.paused===true;refuse=g.refuse??null;}
    const decision=await store.requestScan(username,profile,{configured:configured(),quota,estimateUsd,paused,refuse});
    // Refusals decided in the store (SCANS_PAUSED, BUDGET_EXCEEDED, DAILY_BUDGET_EXCEEDED, GLOBAL_RATE, DAILY_QUOTA).
    if(decision.body?.code&&decision.status>=400)log('warn','gate.denied',{code:decision.body.code,status:decision.status,username,path:'/api/scans'});
    if(decision.run)await startRun(decision.run);
    return json(decision.status,decision.body);
   }
   // "我會去投票" count. GET is public and cacheable; POST stores only the hash of a random device token.
   if(url.pathname==='/api/pledge'){
    if(method==='GET')return json(200,await store.pledgeCount(),{'Cache-Control':'public, max-age=60'});
    if(method!=='POST')return json(405,{error:'不支援的請求'});
    if(foreign)return json(403,{error:'不接受外部網站送出登記'});
    if(!request.headers.get('content-type')?.includes('application/json'))return json(415,{error:'需使用JSON'});
    const text=await readText(request,256);if(text===null)return json(413,{error:'輸入過長'});
    let token;try{const body=JSON.parse(text);if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>k!=='token')||typeof body.token!=='string'||!PLEDGE_TOKEN.test(body.token))throw Error();token=body.token;}catch{return json(400,{error:'只接受 32 位十六進位的 token'});}
    if(pledgeGate){const g=await pledgeGate(request);if(g?.response)return g.response;}
    const outcome=await store.pledge(await sha256Hex(token));
    if(outcome.result==='rate_limited'){log('warn','gate.denied',{code:'RATE_LIMITED',status:429,path:'/api/pledge',scope:'global'});return json(429,{code:'RATE_LIMITED',error:'登記的人太多了，請一分鐘後再試。',count:outcome.count});}
    return json(200,outcome);
   }
   if(method==='GET'&&/^\/api\/scans\/[\w-]+$/.test(url.pathname)){const view=await store.scanView(url.pathname.split('/').pop());return json(view?200:404,view??{error:'找不到查詢紀錄'});}
   return json(404,{error:'找不到API'});
  }catch(e){log('error','api.error',{method:request.method,path:pathPattern(url.pathname),status:500,code:e?.code,error:e});return json(500,{error:'服務暫時無法回應'});}
 };
}
export {json};
