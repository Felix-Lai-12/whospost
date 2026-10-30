// 「即時查」(EXTENSION-SPEC §4.3, decided §10.2 #14, 路 B): an account that is not on the list is checked only when the
// user asks, through the Whospost backend (POST /api/scans from the extension's whitelisted origin, no Turnstile), and
// the extension polls the scan's status route. Pure: the background script does the fetching, the engine the drawing.
// Three answers are kept apart: scanning (nothing to show yet), failed (still "not checked", can retry) and a result,
// which is partial (the 快篩 first pass: posts plus the first page of replies) until the full scan replaces it.
import {TOTAL} from './label.mjs';
import {aiVerdict,contentVerdict,AI_BEHAVIOR_ID,AI_CONTENT_ID} from './signals.mjs';
import {usageWindow,recordUse} from './meter.mjs';
export const SCANS_PATH='/api/scans';
export const HOURLY_LIMIT=10,HOUR_MS=3600000;
export const POLL_MS=2000,POLL_SLOW_MS=3000,POLL_SLOW_AFTER_MS=30000,POLL_MAX_MS=240000;
export const LIVE_TTL_MS=HOUR_MS;
// The two AI judgements start on the site when the scan is analysed and take a few seconds more; after a 即時查 is done
// the extension asks for them every AI_POLL_MS for up to AI_WAIT_MS (Felix 10-30: a minute, not three), so the popover
// gets them without waiting for the list. One not in by then reads unknown.
export const AI_POLL_MS=5000,AI_WAIT_MS=60000;
const AI_PENDING=new Set(['processing','not_requested','scan_not_ready']);
export const STATUSES=Object.freeze(['scanning','partial','done','failed']);
const USERNAME=/^[a-zA-Z0-9_.]{1,30}$/,SCAN_ID=/^[a-f0-9-]{36}$/,HASH=/^[a-f0-9]{64}$/;
export const validUsername=u=>USERNAME.test(String(u??''));
export const validScanId=id=>SCAN_ID.test(String(id??''));
/** The local hourly record ({start, count, last}, meter.mjs). `allowance` says whether one more may start now. The hour
 *  begins with its first start and resets an hour later (Felix 10-27), the way the site's per-address quota counts. */
export const emptyUsage=()=>({});
export function allowance(usage,now=Date.now(),limit=HOURLY_LIMIT){
 const w=usageWindow(usage,now),remaining=Math.max(0,limit-w.count);
 return {allowed:remaining>0,remaining,limit,retryAt:remaining>0?null:w.resetAt};
}
export const recordStart=recordUse;
/** Whether an answer to 「AI 打詐」 started a new check, and so counts against the hour's allowance: the site marks those
 *  `started` (server/store-core.mjs decideScan). A 202 for a check already running (pressed again, or a stuck one
 *  restarted) is not one; the site did not count it either. A site that predates the mark: every 202 counts, as before. */
export const countsAsStart=(status,body)=>status===202&&(typeof body?.started==='boolean'?body.started:true);
/** The list's entry for an account, with the AI judgement this page already got when the list has none yet: the list
 *  can be rebuilt in the seconds between a check finishing and its judgement being written, and would otherwise hide the
 *  judgement just shown until the next list (STATUS P2-2, 10-28 @adventure9968). Likewise a list entry still waiting
 *  for the AI items (aiPending) takes the count this page already settled for the same scan. */
export function withLiveAi(listed,live){
 const e=live?.entry;
 if(!listed||!e)return listed;
 let out=listed;
 if(listed.aiPending&&e.aiPending===false&&e.scanId&&e.scanId===listed.scanId)out={...out,score:e.score,hits:e.hits,assessed:e.assessed,unknown:e.unknown,aiPending:false};
 if(!out.ai&&e.ai)out={...out,ai:e.ai};
 return out;
}
/** HH:MM in Taipei for a timestamp. */
export const taipeiTime=t=>{const d=new Date(t+8*3600000);return `${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}`;};
// What the toast says when a start is refused: the site's own wording where it has one, short otherwise.
const REFUSALS={HOURLY_LIMIT:'這小時的 AI 打詐額度用完了',HOURLY_QUOTA:'這個網路這小時的 AI 打詐額度用完了',RATE_LIMITED:'請求太頻繁，一分鐘後再試',GLOBAL_RATE:'全站查詢量偏高，稍後再試',BUDGET_EXCEEDED:'查詢額度用完了',DAILY_BUDGET_EXCEEDED:'今天的查詢額度用完了',SCANS_PAUSED:'新查詢暫停中',EXTENSION_NOT_ALLOWED:'這個版本還不能用 AI 打詐',EXTENSION_RATE_LIMITED:'AI 打詐太頻繁，請稍後再試',EXTENSION_NOT_CONFIGURED:'這個站還沒開 AI 打詐',NETWORK:'連不上 Whospost'};
export const refusalText=(code,fallback='')=>REFUSALS[code]??fallback??'';
/** The outcome of POST /api/scans: {ok:true, scanId, status, cached} for 200/202, else {ok:false, code, message}.
 *  A 403 is the whitelist (this extension id is not enabled on that site), never a Turnstile problem. */
export function startOutcome(status,body){
 const b=body&&typeof body==='object'?body:{};
 if((status===200||status===202)&&validScanId(b.id))return {ok:true,scanId:b.id,status:b.status??(status===200?'completed':'queued'),cached:b.cached===true};
 const code=typeof b.code==='string'?b.code:status===403?'EXTENSION_NOT_ALLOWED':status===0?'NETWORK':`HTTP_${status}`;
 const retryAt=Date.parse(b.retryAt??'');
 return {ok:false,code,message:refusalText(code,typeof b.error==='string'?b.error.slice(0,80):''),...(Number.isFinite(retryAt)?{retryAt}:{})};
}
const hits=score=>Array.isArray(score?.hits)?score.hits.filter(x=>typeof x==='string'):Array.isArray(score?.items)?score.items.filter(i=>i?.status==='yes').map(i=>i.id):[];
const int=(v,fallback)=>Number.isInteger(v)?v:fallback;
/** A list-shaped entry (lib/list.mjs) from a scan's score block, marked live (and partial for the 快篩 pass). The
 *  status route still gives the six-item score (signals-v2, which 0.1.0 reads), so the two AI items are added here:
 *  pending for a finished check until followAi hears the judgements (withAiVerdict), not part of a 快篩 pass. */
export function liveEntry({h,scanId,score,updated,partial=false}){
 const s=score&&typeof score==='object'?score:{};
 const ids=hits(s);
 return {h,score:int(s.value,null),hits:ids,assessed:int(s.assessed,0),unknown:int(s.unknown,TOTAL-2)+2,aiPending:!partial,evidence:ids.length?'rules':null,ai:null,scanId:scanId??null,updated:updated??null,appeals:0,live:true,partial};
}
/** A live entry once the AI judgements are settled: {behavior, content} from aiFromResponse, each 'yes' | 'no' |
 *  'unknown' | 'pending', or one word for both (a give-up is 'unknown'). Items 7 and 8 count only for yes and no; one
 *  still pending when this is called stays unknown. An entry not waiting for them is returned as it is. */
export function withAiVerdict(entry,verdict){
 if(!entry?.aiPending)return entry;
 const v=typeof verdict==='string'?{behavior:verdict,content:verdict}:verdict??{};
 let {score,hits,assessed,unknown}=entry;
 for(const [id,x] of [[AI_BEHAVIOR_ID,v.behavior],[AI_CONTENT_ID,v.content]]){
  if(x!=='yes'&&x!=='no')continue;
  score=(Number.isInteger(score)?score:0)+(x==='yes'?1:0);
  if(x==='yes')hits=[...hits,id];
  assessed++;unknown--;
 }
 return {...entry,aiPending:false,score,hits,assessed,unknown};
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
/** GET /api/scans/:id/ai → {verdict:{behavior,content}, ai?:{summary,version}, pending?:true}. behavior is item 7
 *  (shared/signals.mjs aiVerdict; not_requested also waits, as the judgement starts right after the check), content
 *  item 8 (contentVerdict on the response's `content`; a scan from before it has none and reads unknown at once).
 *  pending while either is still being written; the summary comes with a ready behaviour judgement.
 *  Cut the way the list cuts it (worker/account-list.mjs aiSummary): kept even when the wording rules flagged it (Felix
 *  10-27), account names replaced by 該帳號, the first sentence, 200 characters at most. */
export function aiFromResponse(body){
 const b=body&&typeof body==='object'?body:{};
 const verdict={behavior:AI_PENDING.has(b.status)?'pending':aiVerdict(b),content:contentVerdict(b.content)};
 const base=verdict.behavior==='pending'||verdict.content==='pending'?{verdict,pending:true}:{verdict};
 const conclusion=b.status==='ready'?b.result?.conclusion:null;
 if(typeof conclusion!=='string')return base;
 let text=conclusion.replace(/@[A-Za-z0-9_.]+/g,'該帳號');
 if(typeof b.account==='string'&&b.account.length>=2)text=text.split(b.account).join('該帳號');
 const first=(text.match(/^[^。！？!?\n]*[。！？!?]?/)?.[0].trim()||text.trim()).slice(0,200);
 return first?{...base,ai:{summary:first,version:typeof b.provenance?.model==='string'?b.provenance.model:null}}:base;
}
/** The poll delay for a scan that started `elapsed` ms ago, or null once POLL_MAX_MS has passed. */
export const pollDelay=elapsed=>elapsed>=POLL_MAX_MS?null:elapsed<POLL_SLOW_AFTER_MS?POLL_MS:POLL_SLOW_MS;
/** The finished results kept in chrome.storage.local (hash → {entry, at}) so a reload or another tab shows them until
 *  the hourly list carries them; entries older than LIVE_TTL_MS are dropped. */
export function pruneResults(saved,now=Date.now()){
 const out={};
 // A result saved while its AI item was pending, and older than the wait for it, reads as unknown: nothing follows it
 // any more after a reload, and the list carries the real judgement soon after.
 for(const [h,r] of Object.entries(saved&&typeof saved==='object'?saved:{}))if(HASH.test(h)&&r&&typeof r==='object'&&Number.isFinite(r.at)&&now-r.at<LIVE_TTL_MS&&r.entry)out[h]=r.entry.aiPending&&now-r.at>=AI_WAIT_MS?{...r,entry:withAiVerdict(r.entry,'unknown')}:r;
 return out;
}
export const withResult=(saved,h,entry,now=Date.now())=>({...pruneResults(saved,now),[h]:{entry:{...entry,h},at:now}});
