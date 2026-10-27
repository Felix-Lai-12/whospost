// The hashed account list (§4.2, decided §10 #11): the whole export is downloaded about once an hour, kept in
// chrome.storage.local with its ETag, and matched in memory. Entries follow worker/account-list.mjs. Pure: the
// background script does the fetching and storing, this file decides what a fetch outcome means.
export const LIST_VERSION='signals-v2';
export const LIST_PATH='/api/list/v1/export/threads-accounts.json';
// Every 10 minutes (Felix 10-27; was an hour): an unchanged list answers 304 with no body, so checking often is cheap,
// and a new result reaches every user within about 20 minutes (the site's 5-minute list and edge caches included).
// 'stale' still means two hours without a successful fetch.
export const LIST_TTL=600000,RETRY_AFTER=300000,STALE_AFTER=2*3600000;
const HASH=/^[a-f0-9]{64}$/;
/** The accounts of an export body, or an Error naming what was wrong (shape, version, a malformed entry). */
export function parseList(body){
 if(!body||typeof body!=='object'||!Array.isArray(body.accounts))throw new Error('清單格式不符');
 if(body.version!==LIST_VERSION)throw new Error(`清單版本不符：${body.version}`);
 const accounts=[];
 for(const a of body.accounts){
  if(!a||typeof a!=='object'||!HASH.test(a.h??''))throw new Error('清單條目格式不符');
  accounts.push({h:a.h,score:Number.isInteger(a.score)?a.score:null,hits:Array.isArray(a.hits)?a.hits.filter(x=>typeof x==='string'):[],assessed:Number.isInteger(a.assessed)?a.assessed:0,unknown:Number.isInteger(a.unknown)?a.unknown:6,evidence:typeof a.evidence==='string'?a.evidence:null,ai:a.ai&&typeof a.ai.summary==='string'?{summary:a.ai.summary.slice(0,200),version:a.ai.version??null}:null,scanId:typeof a.scanId==='string'?a.scanId:null,updated:typeof a.updated==='string'?a.updated:null,appeals:Number.isInteger(a.appeals)?a.appeals:0});
 }
 return {version:body.version,generated:typeof body.generated==='string'?body.generated:null,accounts};
}
export const emptyCache=()=>({version:LIST_VERSION,accounts:null,generated:null,etag:null,fetchedAt:null,failedAt:null,failure:null});
/** 'fresh': a list is held and the last attempt to update it succeeded recently; 'stale': a list is held but the last
 *  attempt failed, or none was made for STALE_AFTER; 'missing': no list at all (never fetched, or every fetch failed). */
export function listStatus(cache,now=Date.now()){
 const c=cache??emptyCache();
 if(!Array.isArray(c.accounts)||c.version!==LIST_VERSION)return 'missing';
 if(c.failedAt&&(!c.fetchedAt||c.failedAt>c.fetchedAt))return 'stale';
 if(!c.fetchedAt||now-c.fetchedAt>STALE_AFTER)return 'stale';
 return 'fresh';
}
/** Whether the background script should fetch now: the list is older than LIST_TTL (or absent) and the last failure
 *  was more than RETRY_AFTER ago. */
export function shouldRefresh(cache,now=Date.now()){
 const c=cache??emptyCache();
 if(c.failedAt&&now-c.failedAt<RETRY_AFTER)return false;
 return !c.fetchedAt||now-c.fetchedAt>=LIST_TTL||!Array.isArray(c.accounts);
}
/** The cache after one fetch: 200 replaces the list, 304 only renews fetchedAt, anything else (404 while the API is
 *  off, 5xx, a network error, a body that does not parse) keeps the old list and records the failure. */
export function applyFetch(cache,outcome,now=Date.now()){
 const c={...(cache??emptyCache())};
 try{
  if(outcome.status===200){const parsed=parseList(outcome.body);return {...c,version:parsed.version,accounts:parsed.accounts,generated:parsed.generated,etag:outcome.etag??null,fetchedAt:now,failedAt:null,failure:null};}
  if(outcome.status===304&&Array.isArray(c.accounts))return {...c,fetchedAt:now,failedAt:null,failure:null};
  return {...c,failedAt:now,failure:outcome.error??`HTTP ${outcome.status}`};
 }catch(e){return {...c,failedAt:now,failure:e.message};}
}
/** Map of hash → entry for in-memory matching. */
export const indexList=accounts=>new Map((accounts??[]).map(a=>[a.h,a]));
