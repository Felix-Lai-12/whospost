// The per-reply state machine (EXTENSION-SPEC §3.2, EXTENSION-UI-REDESIGN-20261023 §3): what one reply is drawn as,
// given the user's trust mark, the list entry, the thread observation and the settings. Pure; the engine writes the
// result into data-whospost. 'collapse' is the decision "fold this away"; on the page, consecutive folded replies
// become one 'group' represented by a "已收起 N 則" row (groupRuns below).
export const STATES=['none','info','fade','collapse','trusted','stale','group'];
/** @returns {{state:string,level:'list'|'thread'|null,reasons:string[],listed:boolean,flagged:boolean,threadHit:boolean}} */
export function decide({trusted=false,shown=false,entry=null,thread=null,listStatus='missing',settings,mode}){
 const m=mode??settings.mode,reasons=[];
 if(trusted)return {state:'trusted',level:null,reasons:['trusted'],listed:!!entry,flagged:false,threadHit:false};
 let want='none',level=null;
 const score=entry?entry.score:null,listed=!!entry,flagged=Number.isInteger(score)&&score>=settings.fadeAt;
 if(entry&&Number.isInteger(score)){
  level='list';reasons.push(`list:score=${score}`);
  want=score>=settings.collapseAt&&m==='collapse'?'collapse':score>=settings.fadeAt?'fade':'info';
 }
 const threadHit=!!thread&&thread.level!=='none';
 if(threadHit){
  level=level??'thread';
  for(const r of thread.reasons)reasons.push(`thread:${r.rule}=${r.n}`);
  // Ten or more replies from one account are folded like a listed hit; a bar-level hit is only a chip.
  const threadWant=thread.level==='fade'?(m==='collapse'?'collapse':'fade'):'info';
  want=rank(threadWant)>rank(want)?threadWant:want;
 }
 if(want==='none')return {state:listStatus==='fresh'||listed?'none':'stale',level:null,reasons,listed,flagged,threadHit};
 if(m==='label'&&want!=='info')want='info';
 // "顯示" on a folded group opens it as dimmed replies with their chips; nothing else changes.
 if(shown&&want==='collapse')want='fade';
 return {state:want,level,reasons,listed,flagged,threadHit};
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
