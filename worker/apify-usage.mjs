// Apify account usage gate: before a new paid scan, read the account's real month-to-date usage from
// GET /v2/users/me/limits (free, read-only; fields data.current.monthlyUsageUsd and data.limits.maxMonthlyUsageUsd)
// and refuse when what is left cannot cover one scan. The site's own ledger only knows what this deployment
// spent; the account limit is what Apify actually enforces, so this is what pauses the site and lets it resume on
// its own once the cycle resets or the limit is raised. One answer is cached per isolate for `ttlMs`, success or
// failure alike, so a burst of submissions costs one request. Any failure (no token, timeout, bad status, odd body)
// fails open: the ledger and Apify itself still cap spend, and the failure is logged.
import {log} from './log.mjs';
export const APIFY_LIMITS_URL='https://api.apify.com/v2/users/me/limits';
const money=v=>Number.isFinite(v)?Number(v.toFixed(4)):null;
// Default logger goes through the shared structured log; tests pass their own {warn}.
const defaultLog={warn:line=>{let fields;try{fields=JSON.parse(line);}catch{fields={message:line};}log('warn','apify.usage_check_failed',fields);}};
export function createApifyUsage({token,fetchImpl=globalThis.fetch,ttlMs=60000,timeoutMs=5000,now=Date.now,log=defaultLog}={}){
 let cache=null;
 const load=async()=>{
  const r=await fetchImpl(APIFY_LIMITS_URL,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(timeoutMs)});
  if(!r.ok)throw Error(`HTTP ${r.status}`);
  const data=(await r.json())?.data,used=Number(data?.current?.monthlyUsageUsd),limit=Number(data?.limits?.maxMonthlyUsageUsd);
  if(!Number.isFinite(used)||!Number.isFinite(limit))throw Error('missing monthlyUsageUsd or maxMonthlyUsageUsd');
  return {used:money(used),limit:money(limit),cycleEndsAt:data.monthlyUsageCycle?.endAt??null};
 };
 /** Resolves {used, limit, cycleEndsAt, checkedAt, error}; error set and used/limit null when the account could not be read. */
 const snapshot=async()=>{
  const t=now();if(cache&&cache.expires>t)return cache.value;
  let value;
  if(!token)value={used:null,limit:null,cycleEndsAt:null,checkedAt:new Date(t).toISOString(),error:'no token'};
  else try{value={...await load(),checkedAt:new Date(t).toISOString(),error:null};}
  catch(e){value={used:null,limit:null,cycleEndsAt:null,checkedAt:new Date(t).toISOString(),error:String(e?.message??e)};log.warn(JSON.stringify({message:'apify usage check failed, scans stay open',error:value.error}));}
  cache={value,expires:t+ttlMs};return value;
 };
 return {
  snapshot,
  /** True when the account cannot pay for one more scan of `estimateUsd`. Unknown usage never blocks. */
  async exhausted(estimateUsd=0){const s=await snapshot();if(s.used===null||s.limit===null||s.limit<=0)return false;return s.used+Math.max(0,estimateUsd)>s.limit+1e-8;},
  reset(){cache=null;}
 };
}
