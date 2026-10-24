// The per-reply state machine (EXTENSION-SPEC §3.2, EXTENSION-UI-REDESIGN-20261023 §3): what one reply is drawn as,
// given the user's trust mark, the list entry, the thread observation and the settings. Pure; the engine writes the
// result into data-whospost. 'collapse' is the decision "fold this away"; on the page, consecutive folded replies
// become one 'group' represented by a "已收起 N 則" row (groupRuns below).
export const STATES=['none','info','fade','collapse','trusted','stale','group','blocked'];
// 即時查 (§4.3) adds a `live` axis to the decision: scanning (chip says so, nothing else changes), partial (the 快篩 result
// draws its chip but never folds or dims: the full result decides that), done (the result counts exactly like a list
// entry) and failed (back to "not checked": none/stale, so a failure can never look like 0 hits).
export const LIVE_STATUSES=['scanning','partial','done','failed'];
/** @returns {{state:string,level:'list'|'thread'|'live'|null,reasons:string[],listed:boolean,flagged:boolean,threadHit:boolean,live:string|null}} */
export function decide({trusted=false,blocked=false,shown=false,entry=null,thread=null,listStatus='missing',settings,mode,live=null}){
 const m=mode??settings.mode,reasons=[];
 const liveStatus=LIVE_STATUSES.includes(live?.status)?live.status:null;
 // The list wins over a live result for the same account; a live result stands in for a missing list entry.
 if(!entry&&(liveStatus==='done'||liveStatus==='partial')&&live.entry)entry={...live.entry,live:true,partial:liveStatus==='partial'};
 // 封鎖助手 (§4.5): an account the user blocked through Whospost is neither marked nor folded any more.
 if(blocked)return {state:'blocked',level:null,reasons:['blocked'],listed:!!entry,flagged:false,threadHit:false,live:liveStatus};
 if(trusted)return {state:'trusted',level:null,reasons:['trusted'],listed:!!entry,flagged:false,threadHit:false,live:liveStatus};
 let want='none',level=null;
 const score=entry?entry.score:null,listed=!!entry,flagged=Number.isInteger(score)&&score>=settings.fadeAt&&!entry.partial;
 if(entry&&Number.isInteger(score)){
  level=entry.live?'live':'list';reasons.push(`${entry.partial?'quick':entry.live?'live':'list'}:score=${score}`);
  want=entry.partial?'info':score>=settings.collapseAt&&m==='collapse'?'collapse':score>=settings.fadeAt?'fade':'info';
 }else if(entry?.live){level='live';reasons.push(entry.partial?'quick:score=null':'live:score=null');want='info';}
 if(liveStatus==='scanning')reasons.push('live:scanning');
 if(liveStatus==='failed')reasons.push('live:failed');
 const threadHit=!!thread&&thread.level!=='none';
 if(threadHit){
  level=level??'thread';
  for(const r of thread.reasons)reasons.push(`thread:${r.rule}=${r.n}`);
  // Ten or more replies from one account are folded like a listed hit; a bar-level hit is only a chip.
  const threadWant=thread.level==='fade'?(m==='collapse'?'collapse':'fade'):'info';
  want=rank(threadWant)>rank(want)?threadWant:want;
 }
 if(want==='none')return {state:listStatus==='fresh'||listed?'none':'stale',level:null,reasons,listed,flagged,threadHit,live:liveStatus};
 if(m==='label'&&want!=='info')want='info';
 // "顯示" on a folded group opens it as dimmed replies with their chips; nothing else changes.
 if(shown&&want==='collapse')want='fade';
 return {state:want,level,reasons,listed,flagged,threadHit,live:liveStatus};
}
const rank=s=>({none:0,info:1,fade:2,collapse:3})[s]??0;
/** Runs of consecutive folded replies, in page order: each run is one "已收起 N 則" row. `items` carry at least
 *  {collapse:boolean}; everything else (hash, username, reasons) rides along for the row's text and actions. */
export function groupRuns(items){
 const groups=[];let current=null;
 items.forEach((item,index)=>{
  if(!item.collapse){current=null;return;}
  if(!current){current={start:index,members:[]};groups.push(current);}
  current.members.push(item);
 });
 return groups;
}
/** The string the engine compares before touching the DOM: nothing changed, nothing redrawn (§6.2 step 3). */
export const renderKey=(h,decision,extra='')=>`${h}|${decision.state}|${decision.reasons.join(',')}|${extra}`;
