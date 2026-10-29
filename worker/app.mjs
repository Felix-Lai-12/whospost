import {createApi,json,readText} from '../server/api.mjs';
import {collectionProfile} from '../server/collection-profile.mjs';
import {shareCard,shareMeta,withShareMeta} from './share-meta.mjs';
import {aiVerdict} from '../shared/signals.mjs';
import {cardVersion} from './og-card.mjs';
import {createApifyUsage} from './apify-usage.mjs';
import {fetchProviderOptions} from './fetch-provider.mjs';
import {log} from './log.mjs';
import {extensionFlags} from './extension-flags.mjs';
import {checkReplyRows} from '../shared/reply-rows.mjs';
import {spotCheck} from '../server/reply-check.mjs';
const SCAN_ID=/^[a-f0-9-]{36}$/;
// A gate refusal: logged (code and status only, never the IP or token) and answered with the coded JSON error.
const deny=(status,code,error,path)=>{log('warn','gate.denied',{code,status,path});return {response:json(status,{code,error})};};
const SITEVERIFY='https://challenges.cloudflare.com/turnstile/v0/siteverify',TURNSTILE_ACTION='scan';
const encoder=new TextEncoder();
const hex=buffer=>[...new Uint8Array(buffer)].map(b=>b.toString(16).padStart(2,'0')).join('');
const sha256=text=>crypto.subtle.digest('SHA-256',encoder.encode(text));
/** The network address a limit counts by: an IPv4 address as it is, an IPv6 address by its /64 (Felix 10-27: one Mac
 *  started 5 scans in a day under a 3-a-day quota, from its IPv4 address and a rotating IPv6 privacy address). */
export function addressKey(ip){
 if(!ip.includes(':'))return ip;
 if(ip.includes('.'))return ip.slice(ip.lastIndexOf(':')+1); // ::ffff:1.2.3.4 is that IPv4 address
 const [head,tail='']=ip.toLowerCase().split('::'),h=head?head.split(':'):[],t=tail?tail.split(':'):[];
 const groups=ip.includes('::')?[...h,...Array(Math.max(0,8-h.length-t.length)).fill('0'),...t]:h;
 return `${groups.slice(0,4).map(g=>g.replace(/^0+(?=.)/,'')).join(':')}::/64`;
}
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
// Edge cache (Cache API, caches.default) in front of the isolate cache: every isolate in a data center shares one
// copy of a finished result and of each card image, so a shared link opened by thousands reaches the data object
// once per data center instead of once per isolate. Keyed by request URL; the stored response's Cache-Control sets
// the TTL. Absent on Node (local server, tests) unless a fake is passed in.
// /api/health is fetched on every page load and each answer sums the spend ledger, so the isolate cache (one copy per
// isolate) let most loads reach the data object; HEALTH_EDGE_TTL shares one answer per data center instead.
const SCAN_EDGE_TTL=600,OG_EDGE_TTL=604800,HEALTH_EDGE_TTL=15;
const SCAN_ROUTE=/^\/api\/scans\/([\w-]+)$/;
// Replies the extension read in the user's browser for one scan (worker/ext-replies.mjs): 30 rows of at most 1000
// characters each fit well under this.
const REPLIES_ROUTE=/^\/api\/scans\/([a-f0-9-]{36})\/replies$/,REPLIES_MAX_BYTES=65536;
// The public hashed account list for the browser extension (worker/account-list.mjs): edge TTL, bucket query size,
// appeal body size and what a Chrome extension origin looks like (32 letters a-p).
// The v3 export (seven items, the AI judgement last) has its own path: the edge cache keys the export without its
// query string, and extension 0.1.0 keeps reading the v2 path unchanged.
const LIST_EXPORT_PATH='/api/list/v1/export/threads-accounts.json',LIST_EXPORT_V3_PATH='/api/list/v1/export/threads-accounts.v3.json',LIST_EDGE_TTL=300,LIST_BUCKETS_MAX=64,APPEAL_MAX_BYTES=2048,TELEMETRY_MAX_BYTES=1024,EXTENSION_ORIGIN=/^chrome-extension:\/\/[a-p]{32}$/;
// Remote switches the browser extension reads from /api/health about once an hour (EXTENSION-SPEC §4.4 rule 3).
// profileLookup: 帳號背景, read in the user's own browser from Threads; WHOSPOST_PROFILE_LOOKUP="0" turns it off for every
// installation within the hour, anything else (or unset) leaves it on.
// block (§4.5, worker/extension-flags.mjs) rides in the same object as profileLookup (§4.4): one `extension` in /api/health.
export const extensionSwitches=env=>({profileLookup:env.WHOSPOST_PROFILE_LOOKUP!=='0',...extensionFlags(env)});
export function createWorkerApp(env,{storeStub,backup,ogStub=null,startScan,fetchImpl=globalThis.fetch,now=Date.now,caches=globalThis.caches,waitUntil=p=>{Promise.resolve(p).catch(()=>{});}}){
 const edge=caches?.default??null;
 // A hit is served as a fresh Response so the marker header can be set on it; a miss is stored as a clone once
 // the response has gone out (waitUntil), only when the caller asked for it (a finished result, a rendered card).
 const edgeMatch=async request=>{if(!edge)return null;try{const hit=await edge.match(request);if(!hit)return null;const r=new Response(hit.body,hit);r.headers.set('X-Whospost-Cache','HIT');return r;}catch{return null;}};
 const edgeStore=(request,response,keep)=>{response.headers.set('X-Whospost-Cache','MISS');if(edge&&keep){try{waitUntil(edge.put(request,response.clone()));}catch{}}return response;};
 const crossAccountSearch=env.WHOSPOST_CROSS_ACCOUNT_SEARCH==='1';
 // The account's real month-to-date usage, read from Apify; WHOSPOST_APIFY_USAGE_CHECK=0 keeps only the site ledger.
 // Apify's usage only matters when a scan may run Apify (as the provider, or as the browser provider's fallback).
 const providers=fetchProviderOptions(env);
 const apifyUsage=env.WHOSPOST_APIFY_USAGE_CHECK==='0'||!providers.usesApify?null:createApifyUsage({token:env.APIFY_TOKEN,fetchImpl,now});
 const profile=collectionProfile(env.WHOSPOST_COLLECTION_PROFILE||'standard');
 // Worst case a new scan can reserve, so a request is refused up front instead of failing halfway.
 const estimateUsd=providers.estimateUsd(profile.postsCapUsd+profile.repliesCapUsd+(crossAccountSearch?.5:0));
 // One 帳號背景 vote per network address (IPv6 by /64), salted apart from the scan quota's hash.
 const profileReporter=async ip=>hex(await sha256(`${env.IP_HASH_SALT??''}:profile:${addressKey(ip)}`)).slice(0,32);
 const gate=async(request,body)=>{
  // Pausing only blocks new paid fetches: saved results are still served (decided in store.requestScan).
  const paused=env.WHOSPOST_SCANS_ENABLED==='0';
  // 即時查 from the browser extension (EXTENSION-SPEC §4.3): a whitelisted chrome-extension:// origin skips Turnstile
  // (an extension page cannot render the challenge); every other gate stays. An empty whitelist closes the channel.
  const extension=scanExtensionOrigin(request);
  // Cloudflare stamps an unspoofable CF-Worker header (the calling Worker's zone) on every subrequest a Worker makes,
  // so a new-scan request carrying one reached us through another Worker proxy — the trick used to rotate
  // cf-connecting-ip and evade the rate limit. Refuse it; allow only our own zone, should a self-call ever exist.
  // GET routes are not gated, so shared results, previews and Meta's link-preview crawler are unaffected.
  const workerCaller=request.headers.get('cf-worker');
  if(workerCaller&&workerCaller!==env.WHOSPOST_ALLOWED_WORKER)return deny(403,'WORKER_PROXY_BLOCKED','偵測到透過 Worker 代理送出的查詢，暫不接受；請直接從網站送出。','/api/scans');
  const ip=request.headers.get('cf-connecting-ip')||'unknown',where=addressKey(ip);
  if(env.SCAN_RATE_LIMITER){const {success}=await env.SCAN_RATE_LIMITER.limit({key:where});if(!success)return deny(429,'RATE_LIMITED','請求太頻繁，請一分鐘後再試。','/api/scans');}
  let admit=null;
  if(extension){
   // The Origin header is whatever the client says it is, and published extension ids are public, so the whitelist
   // alone cannot stop a script from taking this Turnstile-free path. Its own ceiling, counted across every IP under
   // one key, bounds what the channel can start per minute whatever the caller rotates. No binding means closed.
   // The count is spent only when the store says this request will start a scan (api.mjs asks wouldStart first):
   // a saved result or a scan already running is answered without touching it, so repeats cannot crowd out starts.
   if(!env.EXT_SCAN_RATE_LIMITER)return deny(503,'EXTENSION_NOT_CONFIGURED','AI 打詐尚未設定，暫停中。','/api/scans');
   admit=async()=>{const {success}=await env.EXT_SCAN_RATE_LIMITER.limit({key:'extension-global'});return success?null:{status:429,body:{code:'EXTENSION_RATE_LIMITED',error:'AI 打詐太頻繁，請稍後再試。'}};};
   log('info','scan.extension',{path:'/api/scans'});
  }else{
   if(!env.TURNSTILE_SECRET||!env.TURNSTILE_HOSTNAMES)return deny(503,'TURNSTILE_NOT_CONFIGURED','人機驗證尚未設定，暫停新查詢。','/api/scans');
   if(!await verifyTurnstile(env,body.turnstileToken,ip,fetchImpl))return deny(403,'TURNSTILE_FAILED','請先完成人機驗證再送出。','/api/scans');
  }
  // Apify's own monthly limit. Passed to the data object as a refusal for new paid work only, so an account scanned
  // before is still answered from the store. 429 + BUDGET_EXCEEDED is what the frontend already shows as the donation card.
  const refuse=apifyUsage&&await apifyUsage.exhausted(estimateUsd)?{status:429,body:{code:'BUDGET_EXCEEDED',error:'查詢額度用完了，暫停新查詢；已查過的帳號仍可直接看結果。每次查詢都要付資料抓取費，邀請你小額捐款 100 元讓 Whospost 跑到大選截止：https://whospost.bobaboba.me'}}:null;
  // reporter: the same hash the 帳號背景 route counts votes by, so only this address may report the scan it is handed.
  return {paused,quota:{ip:hex(await sha256(`${env.IP_HASH_SALT??''}:${where}`)).slice(0,32),max:Number(env.WHOSPOST_IP_HOURLY_SCANS??10)},refuse,admit,source:extension?'extension':'site',reporter:extension?await profileReporter(ip):null};
 };
 // POST /api/pledge: same Worker-proxy check as new scans, then a per-IP rate limit (PLEDGE_RATE_LIMITER, counted in
 // Cloudflare's memory, nothing stored). No Turnstile: a one-click pledge behind a challenge would not get clicked.
 const pledgeGate=async request=>{
  const workerCaller=request.headers.get('cf-worker');
  if(workerCaller&&workerCaller!==env.WHOSPOST_ALLOWED_WORKER)return deny(403,'WORKER_PROXY_BLOCKED','偵測到透過 Worker 代理送出的登記，暫不接受；請直接從網站送出。','/api/pledge');
  if(env.PLEDGE_RATE_LIMITER){const {success}=await env.PLEDGE_RATE_LIMITER.limit({key:request.headers.get('cf-connecting-ip')||'unknown'});if(!success)return deny(429,'RATE_LIMITED','按太快了，請一分鐘後再試。','/api/pledge');}
  return {};
 };
 const api=createApi({
  store:{requestScan:(...a)=>storeStub.requestScan(...a),wouldStart:(...a)=>storeStub.wouldStart(...a),scanView:id=>cached(`view:${id}`,VIEW_TTL,()=>storeStub.scanView(id),v=>v?.status==='completed'),budgetSummary:()=>cached('budget',HEALTH_TTL,()=>storeStub.budgetSummary()),pledge:h=>storeStub.pledge(h),pledgeCount:()=>cached('pledge',VIEW_TTL,()=>storeStub.pledgeCount())},
  ai:{status:()=>storeStub.aiStatus(),inspect:id=>storeStub.aiInspect(id),start:(id,options)=>storeStub.aiStart(id,options)},
  profile,configured:()=>providers.configured,startRun:startScan,estimateUsd,gate,pledgeGate,allowOrigin:origin=>extensionIdAllowed(origin,{strict:true}),
  // AI runs automatically after a scan; the public route only reads the shared result.
  allowAiStart:false,
  healthExtra:async()=>({fetchProvider:providers.provider,browserFallback:providers.usesBrowser?providers.fallback:null,browser:providers.usesBrowser?await cached('browser',HEALTH_TTL,()=>storeStub.browserSummary()):null,daily:await cached('daily',HEALTH_TTL,()=>storeStub.dailySummary()),apifyMonthly:apifyUsage?await apifyUsage.snapshot().then(({used,limit,cycleEndsAt,checkedAt,error})=>({used,limit,cycleEndsAt,checkedAt,ok:!error})):null,scansEnabled:env.WHOSPOST_SCANS_ENABLED!=='0',extension:extensionSwitches(env),turnstileSiteKey:env.TURNSTILE_SITE_KEY||null,gaMeasurementId:env.GA_MEASUREMENT_ID||null})
 });
 // A shared scan's preview data: the finished view, plus the AI conclusion once it is ready.
 const shareCardFor=async id=>{
  const scan=await cached(`view:${id}`,VIEW_TTL,()=>storeStub.scanView(id),v=>v?.status==='completed');
  const ai=scan?.status==='completed'?await storeStub.aiInspect(id):null,conclusion=ai?.result?.status==='ready'?ai.result.result?.conclusion:null,verdict=aiVerdict(ai?.result);
  return {meta:shareMeta(scan,conclusion,verdict),card:shareCard(scan,conclusion,verdict)};
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
 // The URL carries the version, so the edge keeps a current card for OG_EDGE_TTL (s-maxage: the browser still gets a
 // year) and a new AI conclusion simply moves crawlers to a new URL; an old version is kept briefly, the brand card never.
 const ogImage=async(request,url,id)=>{
  const hit=await edgeMatch(request);if(hit)return hit;
  try{
   const {card}=await shareCardFor(id);
   if(card&&ogStub){
    const version=cardVersion(card),png=await ogStub.png(id,card),current=url.searchParams.get('v')===version;
    return edgeStore(request,new Response(png,{headers:{'content-type':'image/png','cache-control':current?`public, max-age=31536000, s-maxage=${OG_EDGE_TTL}, immutable`:'public, max-age=300'}}),true);
   }
  }catch{}
  const brand=await env.ASSETS.fetch(new Request(`${url.origin}/og.png`)),headers=new Headers(brand.headers);
  headers.set('cache-control','public, max-age=300');
  return edgeStore(request,new Response(brand.body,{status:brand.status,headers}),false);
 };
 // Public hashed account list for the browser extension (/api/list/v1/*), behind WHOSPOST_LIST_ENABLED=1. The two GET
 // answers are public data kept at the edge for LIST_EDGE_TTL under a key without the query string (export) or with the
 // prefixes canonicalised (buckets), so the data object rebuilds the list at most once an hour per data center; a
 // matching If-None-Match is answered 304 here, so every installation's hourly refresh usually carries no body. The
 // CORS header is added per request after the cache, so one stored copy (carrying none) serves every extension.
 // strict: the whitelist must name the extension (new scans: an empty WHOSPOST_EXTENSION_IDS keeps that channel closed);
 // otherwise an empty whitelist accepts any extension origin (the list routes, development).
 const extensionIdAllowed=(origin,{strict=false}={})=>{
  if(!origin||!EXTENSION_ORIGIN.test(origin))return false;
  const ids=(env.WHOSPOST_EXTENSION_IDS??'').split(',').map(s=>s.trim()).filter(Boolean);
  return ids.length?ids.includes(origin.slice('chrome-extension://'.length)):!strict;
 };
 const extensionOrigin=request=>{const origin=request.headers.get('origin');return extensionIdAllowed(origin)?origin:null;};
 const scanExtensionOrigin=request=>{const origin=request.headers.get('origin');return extensionIdAllowed(origin,{strict:true})?origin:null;};
 const withCors=(response,origin,extra={})=>{if(origin){response.headers.set('Access-Control-Allow-Origin',origin);response.headers.set('Vary','Origin');for(const [k,v] of Object.entries(extra))response.headers.set(k,v);}return response;};
 const listJson=async(key,body)=>{const text=JSON.stringify(body);return edgeStore(key,new Response(text,{headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':`public, max-age=${LIST_EDGE_TTL}`,'ETag':`"${hex(await sha256(text)).slice(0,32)}"`,'X-Content-Type-Options':'nosniff'}}),true);};
 const notModified=(request,response)=>{
  const etag=response.headers.get('etag'),given=request.headers.get('if-none-match');
  if(!etag||!given||!given.split(',').some(t=>t.trim()===etag))return response;
  return new Response(null,{status:304,headers:{'ETag':etag,'Cache-Control':response.headers.get('cache-control'),'X-Whospost-Cache':response.headers.get('x-whospost-cache')}});
 };
 const listApi=async(request,url)=>{
  if(env.WHOSPOST_LIST_ENABLED!=='1')return json(404,{error:'找不到API'});
  const origin=extensionOrigin(request);
  if(request.method==='OPTIONS')return origin?withCors(new Response(null,{status:204}),origin,{'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, If-None-Match','Access-Control-Max-Age':'86400'}):new Response(null,{status:403});
  if(request.method==='GET'&&(url.pathname===LIST_EXPORT_PATH||url.pathname===LIST_EXPORT_V3_PATH)){
   const key=new Request(`${url.origin}${url.pathname}`);
   const response=await edgeMatch(key)??await listJson(key,await storeStub.listEntries(url.pathname===LIST_EXPORT_V3_PATH?'signals-v3':undefined));
   return withCors(notModified(request,response),origin,{'Access-Control-Expose-Headers':'ETag'});
  }
  if(request.method==='GET'&&url.pathname==='/api/list/v1/buckets'){
   const prefixes=[...new Set((url.searchParams.get('p')??'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean))].sort();
   if(!prefixes.length||prefixes.length>LIST_BUCKETS_MAX||!prefixes.every(p=>/^[a-f0-9]{4}$/.test(p)))return withCors(json(400,{error:`p 要是 1 到 ${LIST_BUCKETS_MAX} 個 4 位 hex 前綴，以逗號分隔`}),origin);
   const key=new Request(`${url.origin}/api/list/v1/buckets?p=${prefixes.join(',')}`);
   let response=await edgeMatch(key);
   if(!response){const {accounts}=await storeStub.listEntries();response=await listJson(key,Object.fromEntries(prefixes.map(p=>[p,accounts.filter(a=>a.h.startsWith(p))])));}
   return withCors(notModified(request,response),origin,{'Access-Control-Expose-Headers':'ETag'});
  }
  if(request.method==='POST'&&url.pathname==='/api/list/v1/appeal'){
   if(!origin)return deny(403,'EXTENSION_ORIGIN_REQUIRED','只接受來自擴充套件的回報。','/api/list/v1/appeal').response;
   // The same per-IP limiter as new scans under its own keys: 5 appeals a minute per address, counted apart from scans.
   if(env.SCAN_RATE_LIMITER){const {success}=await env.SCAN_RATE_LIMITER.limit({key:`appeal:${request.headers.get('cf-connecting-ip')||'unknown'}`});if(!success)return withCors(deny(429,'RATE_LIMITED','回報太頻繁，請一分鐘後再試。','/api/list/v1/appeal').response,origin);}
   const declared=Number(request.headers.get('content-length'));if(Number.isFinite(declared)&&declared>APPEAL_MAX_BYTES)return withCors(json(413,{error:'回報過長'}),origin);
   let body;try{const text=await request.text();if(text.length>APPEAL_MAX_BYTES)return withCors(json(413,{error:'回報過長'}),origin);body=JSON.parse(text);}catch{return withCors(json(400,{error:'回報格式不正確'}),origin);}
   const result=await storeStub.appeal(body);
   if(!result.ok)return withCors(json(400,{code:result.code,error:'回報格式不正確'}),origin);
   // Drop this data center's copy of the export so the new count shows before the hour is up; other centers wait for the TTL.
   if(result.recorded&&edge){try{waitUntil(edge.delete(new Request(`${url.origin}${LIST_EXPORT_PATH}`)));}catch{}}
   return withCors(json(200,result),origin);
  }
  // 帳號背景 of an 「AI 打詐」 account (worker/account-list.mjs saveProfileReport, Felix 10-27): extension origins only,
  // under the same per-IP limiter. The reporter is a salted hash of the network address (IPv6 by /64), one vote each,
  // and only for a scan that address requested through the extension channel (gate → scan_requesters).
  if(request.method==='POST'&&url.pathname==='/api/list/v1/profile'){
   if(!origin)return deny(403,'EXTENSION_ORIGIN_REQUIRED','只接受來自擴充套件的回報。','/api/list/v1/profile').response;
   const ip=request.headers.get('cf-connecting-ip')||'unknown';
   if(env.SCAN_RATE_LIMITER){const {success}=await env.SCAN_RATE_LIMITER.limit({key:`profile:${ip}`});if(!success)return withCors(deny(429,'RATE_LIMITED','回報太頻繁，請一分鐘後再試。','/api/list/v1/profile').response,origin);}
   const declared=Number(request.headers.get('content-length'));if(Number.isFinite(declared)&&declared>TELEMETRY_MAX_BYTES)return withCors(json(413,{error:'回報過長'}),origin);
   let body;try{const text=await request.text();if(text.length>TELEMETRY_MAX_BYTES)return withCors(json(413,{error:'回報過長'}),origin);body=JSON.parse(text);}catch{return withCors(json(400,{error:'回報格式不正確'}),origin);}
   const result=await storeStub.profileReport(body,await profileReporter(ip));
   // NOT_REQUESTER: this address did not ask for this scan (see saveProfileReport); the extension ignores the answer.
   if(result.code==='NOT_REQUESTER')return withCors(json(403,{code:result.code,error:'只接受發起這次查詢的人回報。'}),origin);
   if(!result.ok)return withCors(json(400,{code:result.code,error:'回報格式不正確'}),origin);
   return withCors(json(200,{ok:true}),origin);
  }
  // 「回報貢獻」(worker/ext-telemetry.mjs): a daily count or a dom_broken notice, extension origins only, under the
  // same per-IP limiter as appeals (an installation sends at most two a day). Stored aggregated; the body is never logged.
  if(request.method==='POST'&&url.pathname==='/api/list/v1/telemetry'){
   if(!origin)return deny(403,'EXTENSION_ORIGIN_REQUIRED','只接受來自擴充套件的回報。','/api/list/v1/telemetry').response;
   if(env.SCAN_RATE_LIMITER){const {success}=await env.SCAN_RATE_LIMITER.limit({key:`telemetry:${request.headers.get('cf-connecting-ip')||'unknown'}`});if(!success)return withCors(deny(429,'RATE_LIMITED','回報太頻繁，請一分鐘後再試。','/api/list/v1/telemetry').response,origin);}
   const declared=Number(request.headers.get('content-length'));if(Number.isFinite(declared)&&declared>TELEMETRY_MAX_BYTES)return withCors(json(413,{error:'回報過長'}),origin);
   let body;try{const text=await request.text();if(text.length>TELEMETRY_MAX_BYTES)return withCors(json(413,{error:'回報過長'}),origin);body=JSON.parse(text);}catch{return withCors(json(400,{error:'回報格式不正確'}),origin);}
   const result=await storeStub.telemetry(body);
   if(!result.ok)return withCors(json(400,{code:result.code,error:'回報格式不正確'}),origin);
   return withCors(json(200,{ok:true}),origin);
  }
  return withCors(json(404,{error:'找不到API'}),origin);
 };
 // POST /api/scans/:id/replies (plan-extension-replies 2026-10-29, P0 shadow mode): the replies the extension read with
 // the user's own Threads session after 「AI 打詐」, sent as {rows}. Behind the replies switch; a whitelisted extension
 // origin and the per-IP limiter as for the other extension routes; only from the address that requested this scan
 // through the extension (asked before anything is fetched); then checked against itself and spot-checked logged out.
 // Stored for the admin's comparison with the scan's own result and nothing else. The answer says only whether it was
 // taken, never how the spot check went, so a forger learns nothing from it.
 const repliesApi=async(request,scanId)=>{
  if(!extensionSwitches(env).replies)return json(404,{error:'找不到API'});
  const origin=scanExtensionOrigin(request);
  if(request.method==='OPTIONS')return origin?withCors(new Response(null,{status:204}),origin,{'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Access-Control-Max-Age':'86400'}):new Response(null,{status:403});
  if(request.method!=='POST')return json(404,{error:'找不到API'});
  if(!origin)return deny(403,'EXTENSION_ORIGIN_REQUIRED','只接受來自擴充套件的回報。','/api/scans/replies').response;
  const ip=request.headers.get('cf-connecting-ip')||'unknown';
  if(env.SCAN_RATE_LIMITER){const {success}=await env.SCAN_RATE_LIMITER.limit({key:`replies:${addressKey(ip)}`});if(!success)return withCors(deny(429,'RATE_LIMITED','回報太頻繁，請一分鐘後再試。','/api/scans/replies').response,origin);}
  // readText stops reading at the byte limit (a body without Content-Length is still bounded; CodeRabbit on #92).
  let text;try{text=await readText(request,REPLIES_MAX_BYTES);}catch{return withCors(json(400,{error:'回報格式不正確'}),origin);}
  if(text===null)return withCors(json(413,{error:'回報過長'}),origin);
  let body;try{body=JSON.parse(text);}catch{return withCors(json(400,{error:'回報格式不正確'}),origin);}
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).join()!=='rows')return withCors(json(400,{code:'INVALID_REPLIES',error:'回報格式不正確'}),origin);
  const refused=result=>result.code==='NOT_REQUESTER'?withCors(json(403,{code:result.code,error:'只接受發起這次查詢的人回報。'}),origin):result.code==='UNKNOWN_SCAN'?withCors(json(404,{code:result.code,error:'找不到查詢紀錄'}),origin):withCors(json(400,{code:result.code,error:'回報格式不正確'}),origin);
  const reporter=await profileReporter(ip),target=await storeStub.extRepliesTarget(scanId,reporter);
  if(!target.ok)return refused(target);
  const checked=checkReplyRows(body.rows,target.username,now());
  if(!checked.ok){log('warn','ext.replies_rejected',{scanId,code:checked.code,index:checked.index});return refused(checked);}
  const spot=await spotCheck(checked.rows,{fetchImpl});
  const saved=await storeStub.extReplies({scanId,reporter,rows:checked.rows,verification:spot.verification,checked:spot.checked});
  if(!saved.ok)return refused(saved);
  log('info','ext.replies',{scanId,username:target.username,replies:checked.rows.length,dropped:checked.dropped.length,parentless:checked.rows.filter(r=>r.parentUrl===null).length,verification:spot.verification,checks:spot.checked.map(c=>c.result).join(',')});
  return withCors(json(200,{ok:true}),origin);
 };
 return async function fetch(request){
  const url=new URL(request.url);
  if(url.pathname==='/'&&request.method==='GET')return sharePage(request,url);
  const og=request.method==='GET'&&url.pathname.match(/^\/api\/og\/([a-f0-9-]{36})\.png$/);
  if(og)return ogImage(request,url,og[1]);
  // Finished results are public and final (the AI judgement is read from /api/scans/:id/ai, never from this view),
  // so a completed view is kept at the edge for SCAN_EDGE_TTL; a running or missing scan is answered fresh.
  // A whitelisted extension polls the status here while its 即時查 runs; the CORS header is added per request after the
  // cache, like the list routes, so one stored copy serves everyone.
  const scanRoute=request.method==='GET'&&url.pathname.match(SCAN_ROUTE);
  if(scanRoute){
   const extension=scanExtensionOrigin(request);
   const hit=await edgeMatch(request);if(hit)return withCors(hit,extension);
   const view=await cached(`view:${scanRoute[1]}`,VIEW_TTL,()=>storeStub.scanView(scanRoute[1]),v=>v?.status==='completed'),completed=view?.status==='completed';
   return withCors(edgeStore(request,json(view?200:404,view??{error:'找不到查詢紀錄'},completed?{'Cache-Control':`public, max-age=${SCAN_EDGE_TTL}`}:{}),completed),extension);
  }
  if(url.pathname==='/api/scans'&&request.method==='OPTIONS'){const extension=scanExtensionOrigin(request);return extension?withCors(new Response(null,{status:204}),extension,{'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Access-Control-Max-Age':'86400'}):new Response(null,{status:403});}
  if(url.pathname==='/api/scans'&&request.method==='POST'){const extension=scanExtensionOrigin(request);const response=await api(request);return extension?withCors(response,extension):response;}
  if(request.method==='GET'&&url.pathname==='/api/health'){
   // One key without the query string: the answer ignores it, so ?anything would otherwise skip the shared copy.
   const key=new Request(`${url.origin}/api/health`);
   const hit=await edgeMatch(key);if(hit)return hit;
   const response=await api(request);
   if(response.status!==200)return edgeStore(key,response,false);
   response.headers.set('Cache-Control',`public, max-age=${HEALTH_EDGE_TTL}`);
   return edgeStore(key,response,true);
  }
  if(url.pathname.startsWith('/api/list/v1/'))return listApi(request,url);
  const replies=url.pathname.match(REPLIES_ROUTE);
  if(replies)return repliesApi(request,replies[1]);
  const release=url.pathname.match(/^\/api\/admin\/scans\/([\w-]+)\/release-dispatch$/),diagnose=url.pathname.match(/^\/api\/admin\/scans\/([\w-]+)\/ai-(diagnose|revalidate|start)$/);
  if(url.pathname==='/api/admin/import'||url.pathname==='/api/admin/backup'||url.pathname==='/api/admin/scans'||url.pathname==='/api/admin/requests'||url.pathname==='/api/admin/scans/fail-empty'||url.pathname==='/api/admin/ext-telemetry'||url.pathname==='/api/admin/profile-stats'||url.pathname==='/api/admin/ext-replies'||release||diagnose){
   if(!env.ADMIN_TOKEN||request.method!=='POST')return json(404,{error:'找不到API'});
   if(!await secretEquals(request.headers.get('authorization')??'',`Bearer ${env.ADMIN_TOKEN}`))return json(401,{error:'未授權'});
   // ai-start queues the judgement for a saved scan that has none under the current provider (imported seeds, a
   // provider switch); the public POST is read-only in the Worker. Retryable failures are retried, finished jobs are returned.
   if(diagnose){const result=await (diagnose[2]==='start'?storeStub.aiStart(diagnose[1],{retry:true}):diagnose[2]==='revalidate'?storeStub.aiRevalidate(diagnose[1]):storeStub.aiDiagnose(diagnose[1]));return json(result?200:404,result??{error:'找不到查詢紀錄'});}
   if(url.pathname==='/api/admin/backup'){if(!backup)return json(503,{error:'未設定備份'});return json(200,await backup());}
   if(url.pathname==='/api/admin/scans')return json(200,{scans:await storeStub.adminScans()});
   // The extension's aggregated usage counts (§8), last {days} days: curl -X POST -H 'authorization: Bearer …' -d '{"days":14}'.
   if(url.pathname==='/api/admin/ext-telemetry'){let days;try{days=(await request.json())?.days;}catch{}return json(200,await storeStub.telemetrySummary(days));}
   if(url.pathname==='/api/admin/requests')return json(200,await storeStub.requestLog());
   // 帳號背景 over the listed accounts (Felix 10-27): counts by place and by joined year / month, unknowns apart.
   if(url.pathname==='/api/admin/profile-stats')return json(200,await storeStub.profileStats());
   // The extension-replies shadow comparison (worker/ext-replies.mjs): spot-check outcomes and agreement with the scans.
   if(url.pathname==='/api/admin/ext-replies')return json(200,await storeStub.extRepliesSummary());
   if(url.pathname==='/api/admin/scans/fail-empty')return json(200,await storeStub.failEmptyScans());
   if(release){const result=await storeStub.releaseUnknownDispatch(release[1]);return json(result?200:404,result??{error:'找不到查詢紀錄'});}
   return json(200,await storeStub.importSeed(await request.json()));
  }
  return await api(request)??env.ASSETS.fetch(request);
 };
}
