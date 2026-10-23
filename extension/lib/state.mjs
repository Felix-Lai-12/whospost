// The per-reply state machine (§3.2): what one reply container is drawn as, given the user's trust mark, the list
// entry, the thread observation and the settings. Pure; the engine writes the result into data-whospost.
export const STATES=['none','info','fade','collapse','trusted','stale'];
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
  const threadWant=thread.level==='fade'?'fade':'info';
  want=rank(threadWant)>rank(want)?threadWant:want;
 }
 if(want==='none')return {state:listStatus==='fresh'||listed?'none':'stale',level:null,reasons,listed,flagged,threadHit};
 if(m==='label'&&want!=='info')want='info';
 if(shown&&want!=='info')want='info';
 return {state:want,level,reasons,listed,flagged,threadHit};
}
const rank=s=>({none:0,info:1,fade:2,collapse:3})[s]??0;
/** The string the engine compares before touching the DOM: nothing changed, nothing redrawn (§6.2 step 3). */
export const renderKey=(h,decision,extra='')=>`${h}|${decision.state}|${decision.reasons.join(',')}|${extra}`;
