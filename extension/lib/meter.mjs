// The hourly allowances (即時查, 帳號背景) and the popup's usage meters (Felix 10-26, after Claude's usage page): one bar
// per allowance, what is left on the right, and when it resets. An hour starts with its first use and resets one hour
// later (Felix 10-27: not on the clock hour, not rolling); the next use after that starts a new hour. The site's
// per-address quota counts the same way. Pure: no chrome.* here.
export const HOUR_MS=3600000;
/** The usage record ({start, count, last}) as it stands at `now`: active while inside the hour that began at `start`.
 *  A record from before 10-27 ({stamps}) is read as an hour that began at its oldest stamp of the last hour.
 *  `last` (the latest use, any hour) stays for pacing rules that look across the reset. */
export function usageWindow(usage,now=Date.now()){
 let start=null,count=0,last=Number.isFinite(usage?.last)&&usage.last<=now?usage.last:null;
 if(Number.isFinite(usage?.start)){start=usage.start;count=Math.max(0,Math.floor(Number(usage.count)||0));}
 else if(Array.isArray(usage?.stamps)){
  const s=usage.stamps.filter(t=>Number.isFinite(t)&&t<=now&&now-t<HOUR_MS);
  if(s.length){start=Math.min(...s);count=s.length;last=Math.max(...s);}
 }
 const active=start!==null&&start<=now&&now<start+HOUR_MS&&count>0;
 return {active,start:active?start:null,count:active?count:0,resetAt:active?start+HOUR_MS:null,last};
}
/** The record after one more use at `now`: counted in the running hour, or the first use of a new one. */
export function recordUse(usage,now=Date.now()){
 const w=usageWindow(usage,now);
 return w.active?{start:w.start,count:w.count+1,last:now}:{start:now,count:1,last:now};
}
/** The meter for a usage record against an hourly limit. level: 'ok' | 'high' (80% or more) | 'full'. */
export function meter(usage,limit,now=Date.now()){
 const w=usageWindow(usage,now);
 const used=Math.min(w.count,limit),remaining=limit-used,pct=Math.round(used/limit*100);
 return {used,limit,remaining,pct,level:remaining===0?'full':pct>=80?'high':'ok',resetAt:w.resetAt};
}
const minutes=(t,now)=>Math.max(1,Math.ceil((t-now)/60000));
/** The words beside and under the bar: right = used/limit (Felix 10-26: 「0/10」), caption = what is left and when it resets. */
export function meterText(m,now=Date.now()){
 const right=`${m.used}/${m.limit}`;
 if(!m.used)return {right,caption:`每小時 ${m.limit} 次，從第一次用起算`};
 const reset=`${minutes(m.resetAt,now)} 分鐘後重設`;
 return {right,caption:m.remaining?`還剩 ${m.remaining} 次 · ${reset}`:`這小時用完了 · ${reset}`};
}
