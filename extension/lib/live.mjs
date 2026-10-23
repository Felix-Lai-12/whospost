// 「即時查」(EXTENSION-SPEC §4.3, decided §10.2 #14, 路 B): an account that is not on the list is checked only when the
// user asks, through the Whospost backend (POST /api/scans from the extension's whitelisted origin, no Turnstile), and
// the extension polls the scan's status route. Pure: the background script does the fetching, the engine the drawing.
// Three answers are kept apart: scanning (nothing to show yet), failed (still "not checked", can retry) and a result,
// which is partial (the 快篩 first pass: posts plus the first page of replies) until the full scan replaces it.
import {TOTAL} from './label.mjs';
export const SCANS_PATH='/api/scans';
export const HOURLY_LIMIT=10,HOUR_MS=3600000;
export const POLL_MS=2000,POLL_SLOW_MS=3000,POLL_SLOW_AFTER_MS=30000,POLL_MAX_MS=240000;
export const LIVE_TTL_MS=HOUR_MS;
export const STATUSES=Object.freeze(['scanning','partial','done','failed']);
const USERNAME=/^[a-zA-Z0-9_.]{1,30}$/,SCAN_ID=/^[a-f0-9-]{36}$/,HASH=/^[a-f0-9]{64}$/;
export const validUsername=u=>USERNAME.test(String(u??''));
export const validScanId=id=>SCAN_ID.test(String(id??''));
/** The local hourly record: when the last starts happened. `allowance` says whether one more may start now. */
export const emptyUsage=()=>({stamps:[]});
const recent=(usage,now)=>(Array.isArray(usage?.stamps)?usage.stamps:[]).filter(t=>Number.isFinite(t)&&now-t<HOUR_MS&&t<=now);
export function allowance(usage,now=Date.now(),limit=HOURLY_LIMIT){
 const stamps=recent(usage,now),remaining=Math.max(0,limit-stamps.length);
 return {allowed:remaining>0,remaining,limit,retryAt:remaining>0?null:Math.min(...stamps)+HOUR_MS};
}
export const recordStart=(usage,now=Date.now())=>({stamps:[...recent(usage,now),now]});
/** HH:MM in Taipei for a timestamp. */
export const taipeiTime=t=>{const d=new Date(t+8*3600000);return `${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}`;};
// What the toast says when a start is refused: the site's own wording where it has one, short otherwise.
const REFUSALS={HOURLY_LIMIT:'這小時的即時查用完了',DAILY_QUOTA:'今天的即時查次數用完了',RATE_LIMITED:'請求太頻繁，一分鐘後再試',GLOBAL_RATE:'全站查詢量偏高，稍後再試',BUDGET_EXCEEDED:'查詢額度用完了',DAILY_BUDGET_EXCEEDED:'今天的查詢額度用完了',SCANS_PAUSED:'新查詢暫停中',EXTENSION_NOT_ALLOWED:'這個版本還不能即時查',EXTENSION_RATE_LIMITED:'即時查太頻繁，請稍後再試',EXTENSION_NOT_CONFIGURED:'這個站還沒開即時查',NETWORK:'連不上 Whospost'};
export const refusalText=(code,fallback='')=>REFUSALS[code]??fallback??'';
/** The outcome of POST /api/scans: {ok:true, scanId, status, cached} for 200/202, else {ok:false, code, message}.
 *  A 403 is the whitelist (this extension id is not enabled on that site), never a Turnstile problem. */
export function startOutcome(status,body){
 const b=body&&typeof body==='object'?body:{};
 if((status===200||status===202)&&validScanId(b.id))return {ok:true,scanId:b.id,status:b.status??(status===200?'completed':'queued'),cached:b.cached===true};
 const code=typeof b.code==='string'?b.code:status===403?'EXTENSION_NOT_ALLOWED':status===0?'NETWORK':`HTTP_${status}`;
 return {ok:false,code,message:refusalText(code,typeof b.error==='string'?b.error.slice(0,80):'')};
}
const hits=score=>Array.isArray(score?.hits)?score.hits.filter(x=>typeof x==='string'):Array.isArray(score?.items)?score.items.filter(i=>i?.status==='yes').map(i=>i.id):[];
const int=(v,fallback)=>Number.isInteger(v)?v:fallback;
/** A list-shaped entry (lib/list.mjs) from a scan's score block, marked live (and partial for the 快篩 pass). */
export function liveEntry({h,scanId,score,updated,partial=false}){
 const s=score&&typeof score==='object'?score:{};
 const ids=hits(s);
 return {h,score:int(s.value,null),hits:ids,assessed:int(s.assessed,0),unknown:int(s.unknown,TOTAL),evidence:ids.length?'rules':null,ai:null,scanId:scanId??null,updated:updated??null,appeals:0,live:true,partial};
}
/** What a status view (GET /api/scans/:id) means for the chip: scanning, partial, done or failed. */
export function liveFromView(view,{h,now=Date.now()}={}){
 const v=view&&typeof view==='object'?view:null;
 if(!v||!['queued','running','completed','failed'].includes(v.status))return {status:'failed',code:'BAD_VIEW',message:'讀不到查詢狀態',at:now};
 if(v.status==='failed')return {status:'failed',code:v.error?.code??'FAILED',message:typeof v.error?.message==='string'?v.error.message.slice(0,80):'查詢失敗',scanId:v.id,at:now};
 if(v.status==='completed')return {status:'done',scanId:v.id,entry:liveEntry({h,scanId:v.id,score:v.score,updated:v.completedAt??null}),at:now};
 if(v.quick?.partial===true&&v.quick.score)return {status:'partial',scanId:v.id,entry:liveEntry({h,scanId:v.id,score:v.quick.score,updated:v.quick.at??null,partial:true}),comments:int(v.quick.comments,0),posts:int(v.quick.posts,0),progress:typeof v.progress==='string'?v.progress:'',at:now};
 return {status:'scanning',scanId:v.id,progress:typeof v.progress==='string'?v.progress:'',at:now};
}
/** The poll delay for a scan that started `elapsed` ms ago, or null once POLL_MAX_MS has passed. */
export const pollDelay=elapsed=>elapsed>=POLL_MAX_MS?null:elapsed<POLL_SLOW_AFTER_MS?POLL_MS:POLL_SLOW_MS;
/** The finished results kept in chrome.storage.local (hash → {entry, at}) so a reload or another tab shows them until
 *  the hourly list carries them; entries older than LIVE_TTL_MS are dropped. */
export function pruneResults(saved,now=Date.now()){
 const out={};
 for(const [h,r] of Object.entries(saved&&typeof saved==='object'?saved:{}))if(HASH.test(h)&&r&&typeof r==='object'&&Number.isFinite(r.at)&&now-r.at<LIVE_TTL_MS&&r.entry)out[h]=r;
 return out;
}
export const withResult=(saved,h,entry,now=Date.now())=>({...pruneResults(saved,now),[h]:{entry:{...entry,h},at:now}});
