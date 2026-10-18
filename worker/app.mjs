import {createApi,json} from '../server/api.mjs';
import {collectionProfile} from '../server/collection-profile.mjs';
const SITEVERIFY='https://challenges.cloudflare.com/turnstile/v0/siteverify';
const safeEqual=(a,b)=>{if(a.length!==b.length)return false;if(crypto.subtle.timingSafeEqual)return crypto.subtle.timingSafeEqual(a,b);let d=0;for(let i=0;i<a.length;i++)d|=a[i]^b[i];return d===0;};
const hex=buffer=>[...new Uint8Array(buffer)].map(b=>b.toString(16).padStart(2,'0')).join('');
/**
 * Worker request handling: /api/* goes to the shared API with Worker-only protections; everything else
 * is a static asset. New scans pass a kill switch, a per-IP rate limit and Turnstile; the IP daily quota and
 * spend caps are enforced atomically in the data Durable Object. Raw IPs are never stored, only salted hashes.
 */
export function createWorkerApp(env,{storeStub,startScan,fetchImpl=globalThis.fetch}){
 const crossAccountSearch=env.WHOSPOST_CROSS_ACCOUNT_SEARCH==='1';
 const profile=collectionProfile(env.WHOSPOST_COLLECTION_PROFILE||'standard');
 // Worst case a new scan can reserve, so a request is refused up front instead of failing halfway.
 const estimateUsd=profile.postsCapUsd+profile.repliesCapUsd+(crossAccountSearch?.5:0);
 const gate=async(request,body)=>{
  if(env.WHOSPOST_SCANS_ENABLED==='0')return {response:json(503,{code:'SCANS_PAUSED',error:'新查詢暫停中；已查過的帳號仍可直接看結果。'})};
  const ip=request.headers.get('cf-connecting-ip')||'unknown';
  if(env.SCAN_RATE_LIMITER){const {success}=await env.SCAN_RATE_LIMITER.limit({key:ip});if(!success)return {response:json(429,{code:'RATE_LIMITED',error:'請求太頻繁，請一分鐘後再試。'})};}
  if(!env.TURNSTILE_SECRET)return {response:json(503,{code:'TURNSTILE_NOT_CONFIGURED',error:'人機驗證尚未設定，暫停新查詢。'})};
  const token=typeof body.turnstileToken==='string'?body.turnstileToken:'';
  let verified=false;
  if(token&&token.length<=2048){try{const form=new FormData();form.append('secret',env.TURNSTILE_SECRET);form.append('response',token);form.append('remoteip',ip);verified=(await (await fetchImpl(SITEVERIFY,{method:'POST',body:form})).json()).success===true;}catch{verified=false;}}
  if(!verified)return {response:json(403,{code:'TURNSTILE_FAILED',error:'請先完成人機驗證再送出。'})};
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${env.IP_HASH_SALT??''}:${ip}`));
  return {quota:{ip:hex(digest).slice(0,32),max:Number(env.WHOSPOST_IP_DAILY_SCANS??3)}};
 };
 const api=createApi({
  store:{requestScan:(...a)=>storeStub.requestScan(...a),scanView:id=>storeStub.scanView(id),budgetSummary:()=>storeStub.budgetSummary()},
  ai:{status:()=>storeStub.aiStatus(),inspect:id=>storeStub.aiInspect(id),start:(id,options)=>storeStub.aiStart(id,options)},
  profile,configured:()=>!!env.APIFY_TOKEN,startRun:startScan,estimateUsd,gate,
  // AI runs automatically after a scan; the public route only reads the shared result.
  allowAiStart:false,
  healthExtra:async()=>({daily:await storeStub.dailySummary(),scansEnabled:env.WHOSPOST_SCANS_ENABLED!=='0',turnstileSiteKey:env.TURNSTILE_SITE_KEY||null})
 });
 return async function fetch(request){
  const url=new URL(request.url);
  if(url.pathname==='/api/admin/import'){
   if(!env.ADMIN_TOKEN||request.method!=='POST')return json(404,{error:'找不到API'});
   const given=new TextEncoder().encode(request.headers.get('authorization')??''),expected=new TextEncoder().encode(`Bearer ${env.ADMIN_TOKEN}`);
   if(!safeEqual(given,expected))return json(401,{error:'未授權'});
   return json(200,await storeStub.importSeed(await request.json()));
  }
  return await api(request)??env.ASSETS.fetch(request);
 };
}
