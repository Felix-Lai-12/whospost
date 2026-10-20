import {createApi,json} from '../server/api.mjs';
import {collectionProfile} from '../server/collection-profile.mjs';
import {shareCard,shareMeta,withShareMeta} from './share-meta.mjs';
import {cardVersion} from './og-card.mjs';
import {createApifyUsage} from './apify-usage.mjs';
const SCAN_ID=/^[a-f0-9-]{36}$/;
const SITEVERIFY='https://challenges.cloudflare.com/turnstile/v0/siteverify',TURNSTILE_ACTION='scan';
const encoder=new TextEncoder();
const hex=buffer=>[...new Uint8Array(buffer)].map(b=>b.toString(16).padStart(2,'0')).join('');
const sha256=text=>crypto.subtle.digest('SHA-256',encoder.encode(text));
// Hash both sides to a fixed size first so neither length nor content leaks through timing.
async function secretEquals(given,expected){const [a,b]=await Promise.all([sha256(given),sha256(expected)]);return crypto.subtle.timingSafeEqual?crypto.subtle.timingSafeEqual(a,b):hex(a)===hex(b);}
// Per-isolate cache for finished results and health, so read bursts (a shared result going viral) do not all
// reach the single data object. Public data only; short TTLs keep AI status and partner scores fresh.
const VIEW_TTL=60000,HEALTH_TTL=10000,MAX_CACHED=200,readCache=new Map();
async function cached(key,ttl,load,keep=()=>true){
 const hit=readCache.get(key),now=Date.now();if(hit&&hit.expires>now)return hit.value;
 const value=await load();
 if(keep(value)){readCache.delete(key);readCache.set(key,{value,expires:now+ttl});if(readCache.size>MAX_CACHED)readCache.delete(readCache.keys().next().value);}
 return value;
}
/** Turnstile siteverify, fail-closed: success, the expected action and an allowed frontend hostname are all required.
 *  Cloudflare's test keys return no action and hostname example.com; they pass only with TURNSTILE_ALLOW_TEST_KEY=1 (local dev). */
async function verifyTurnstile(env,token,ip,fetchImpl){
 const hostnames=new Set((env.TURNSTILE_HOSTNAMES??'').split(',').map(h=>h.trim()).filter(Boolean));
 if(typeof token!=='string'||!token||token.length>2048||!hostnames.size)return false;
 try{
  const r=await fetchImpl(SITEVERIFY,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},signal:AbortSignal.timeout(10000),body:new URLSearchParams({secret:env.TURNSTILE_SECRET,response:token,remoteip:ip})});
  if(!r.ok)return false;
  const result=await r.json(),testKey=env.TURNSTILE_ALLOW_TEST_KEY==='1'&&result.metadata?.result_with_testing_key===true;
  return result.success===true&&hostnames.has(result.hostname)&&(result.action===TURNSTILE_ACTION||testKey);
 }catch{return false;}
}
/**
 * Worker request handling: /api/* goes to the shared API with Worker-only protections; everything else
 * is a static asset. New scans pass a kill switch, a per-IP rate limit and Turnstile; the IP daily quota and
 * spend caps are enforced atomically in the data Durable Object. Raw IPs are never stored, only salted hashes.
 */
export function createWorkerApp(env,{storeStub,ogStub=null,startScan,fetchImpl=globalThis.fetch,now=Date.now}){
 const crossAccountSearch=env.WHOSPOST_CROSS_ACCOUNT_SEARCH==='1';
 // The account's real month-to-date usage, read from Apify; WHOSPOST_APIFY_USAGE_CHECK=0 keeps only the site ledger.
 const apifyUsage=env.WHOSPOST_APIFY_USAGE_CHECK==='0'?null:createApifyUsage({token:env.APIFY_TOKEN,fetchImpl,now});
 const profile=collectionProfile(env.WHOSPOST_COLLECTION_PROFILE||'standard');
 // Worst case a new scan can reserve, so a request is refused up front instead of failing halfway.
 const estimateUsd=profile.postsCapUsd+profile.repliesCapUsd+(crossAccountSearch?.5:0);
 const gate=async(request,body)=>{
  // Pausing only blocks new paid fetches: saved results are still served (decided in store.requestScan).
  const paused=env.WHOSPOST_SCANS_ENABLED==='0';
  // Cloudflare stamps an unspoofable CF-Worker header (the calling Worker's zone) on every subrequest a Worker makes,
  // so a new-scan request carrying one reached us through another Worker proxy — the trick used to rotate
  // cf-connecting-ip and evade the rate limit. Refuse it; allow only our own zone, should a self-call ever exist.
  // GET routes are not gated, so shared results, previews and Meta's link-preview crawler are unaffected.
  const workerCaller=request.headers.get('cf-worker');
  if(workerCaller&&workerCaller!==env.WHOSPOST_ALLOWED_WORKER)return {response:json(403,{code:'WORKER_PROXY_BLOCKED',error:'偵測到透過 Worker 代理送出的查詢，暫不接受；請直接從網站送出。'})};
  const ip=request.headers.get('cf-connecting-ip')||'unknown';
  if(env.SCAN_RATE_LIMITER){const {success}=await env.SCAN_RATE_LIMITER.limit({key:ip});if(!success)return {response:json(429,{code:'RATE_LIMITED',error:'請求太頻繁，請一分鐘後再試。'})};}
  if(!env.TURNSTILE_SECRET||!env.TURNSTILE_HOSTNAMES)return {response:json(503,{code:'TURNSTILE_NOT_CONFIGURED',error:'人機驗證尚未設定，暫停新查詢。'})};
  if(!await verifyTurnstile(env,body.turnstileToken,ip,fetchImpl))return {response:json(403,{code:'TURNSTILE_FAILED',error:'請先完成人機驗證再送出。'})};
  // Apify's own monthly limit. Passed to the data object as a refusal for new paid work only, so an account scanned
  // before is still answered from the store. 429 + BUDGET_EXCEEDED is what the frontend already shows as the donation card.
  const refuse=apifyUsage&&await apifyUsage.exhausted(estimateUsd)?{status:429,body:{code:'BUDGET_EXCEEDED',error:'查詢額度用完了，暫停新查詢；已查過的帳號仍可直接看結果。每次查詢都要付資料抓取費，邀請你小額捐款 100 元讓 Whospost 跑到大選截止：https://whospost.bobaboba.me'}}:null;
  return {paused,quota:{ip:hex(await sha256(`${env.IP_HASH_SALT??''}:${ip}`)).slice(0,32),max:Number(env.WHOSPOST_IP_DAILY_SCANS??3)},refuse};
 };
 const api=createApi({
  store:{requestScan:(...a)=>storeStub.requestScan(...a),scanView:id=>cached(`view:${id}`,VIEW_TTL,()=>storeStub.scanView(id),v=>v?.status==='completed'),budgetSummary:()=>storeStub.budgetSummary()},
  ai:{status:()=>storeStub.aiStatus(),inspect:id=>storeStub.aiInspect(id),start:(id,options)=>storeStub.aiStart(id,options)},
  profile,configured:()=>!!env.APIFY_TOKEN,startRun:startScan,estimateUsd,gate,
  // AI runs automatically after a scan; the public route only reads the shared result.
  allowAiStart:false,
  healthExtra:async()=>({daily:await cached('daily',HEALTH_TTL,()=>storeStub.dailySummary()),apifyMonthly:apifyUsage?await apifyUsage.snapshot().then(({used,limit,cycleEndsAt,checkedAt,error})=>({used,limit,cycleEndsAt,checkedAt,ok:!error})):null,scansEnabled:env.WHOSPOST_SCANS_ENABLED!=='0',turnstileSiteKey:env.TURNSTILE_SITE_KEY||null,gaMeasurementId:env.GA_MEASUREMENT_ID||null})
 });
 // A shared scan's preview data: the finished view, plus the AI conclusion once it is ready.
 const shareCardFor=async id=>{
  const scan=await cached(`view:${id}`,VIEW_TTL,()=>storeStub.scanView(id),v=>v?.status==='completed');
  const ai=scan?.status==='completed'?await storeStub.aiInspect(id):null,conclusion=ai?.result?.status==='ready'?ai.result.result?.conclusion:null;
  return {meta:shareMeta(scan,conclusion),card:shareCard(scan,conclusion)};
 };
 // The home page carries link-preview tags; a shared ?scan=<id> gets that account's title, summary and card image.
 // Any lookup failure falls back to the site-wide preview so the page itself always loads.
 const sharePage=async(request,url)=>{
  const page=await env.ASSETS.fetch(request);
  if(!page.ok||!page.headers.get('content-type')?.includes('text/html'))return page;
  const id=url.searchParams.get('scan');let meta=null;
  if(id&&SCAN_ID.test(id)){
   try{
    const share=await shareCardFor(id);meta=share.meta;
    if(meta){meta.url=`${url.origin}/?scan=${id}`;if(ogStub)meta.image=`${url.origin}/api/og/${id}.png?v=${cardVersion(share.card)}`;}
   }catch{meta=null;}
  }
  const html=withShareMeta(await page.text(),{url:`${url.origin}/`,image:`${url.origin}/og.png`,...meta});
  const headers=new Headers(page.headers);headers.delete('content-length');headers.delete('etag');
  return new Response(html,{status:page.status,headers});
 };
 // The card image for a shared scan, rendered and stored by the OG image Durable Object. A URL with the current
 // version never changes, so it is cached for a year; anything that cannot be rendered gets the brand card.
 const ogImage=async(url,id)=>{
  try{
   const {card}=await shareCardFor(id);
   if(card&&ogStub){
    const version=cardVersion(card),png=await ogStub.png(id,card);
    return new Response(png,{headers:{'content-type':'image/png','cache-control':url.searchParams.get('v')===version?'public, max-age=31536000, immutable':'public, max-age=300'}});
   }
  }catch{}
  const brand=await env.ASSETS.fetch(new Request(`${url.origin}/og.png`)),headers=new Headers(brand.headers);
  headers.set('cache-control','public, max-age=300');
  return new Response(brand.body,{status:brand.status,headers});
 };
 return async function fetch(request){
  const url=new URL(request.url);
  if(url.pathname==='/'&&request.method==='GET')return sharePage(request,url);
  const og=request.method==='GET'&&url.pathname.match(/^\/api\/og\/([a-f0-9-]{36})\.png$/);
  if(og)return ogImage(url,og[1]);
  const release=url.pathname.match(/^\/api\/admin\/scans\/([\w-]+)\/release-dispatch$/),diagnose=url.pathname.match(/^\/api\/admin\/scans\/([\w-]+)\/ai-(diagnose|revalidate)$/);
  if(url.pathname==='/api/admin/import'||url.pathname==='/api/admin/scans'||url.pathname==='/api/admin/requests'||release||diagnose){
   if(!env.ADMIN_TOKEN||request.method!=='POST')return json(404,{error:'找不到API'});
   if(!await secretEquals(request.headers.get('authorization')??'',`Bearer ${env.ADMIN_TOKEN}`))return json(401,{error:'未授權'});
   if(diagnose){const result=await (diagnose[2]==='revalidate'?storeStub.aiRevalidate(diagnose[1]):storeStub.aiDiagnose(diagnose[1]));return json(result?200:404,result??{error:'找不到查詢紀錄'});}
   if(url.pathname==='/api/admin/scans')return json(200,{scans:await storeStub.adminScans()});
   if(url.pathname==='/api/admin/requests')return json(200,await storeStub.requestLog());
   if(release){const result=await storeStub.releaseUnknownDispatch(release[1]);return json(result?200:404,result??{error:'找不到查詢紀錄'});}
   return json(200,await storeStub.importSeed(await request.json()));
  }
  return await api(request)??env.ASSETS.fetch(request);
 };
}
