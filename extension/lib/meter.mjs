// The popup's usage meters (Felix 10-26, after Claude's usage page): one bar per hourly allowance, what is left on the
// right, and when it resets. Both allowances are clock hours, reset on the hour (Felix 10-27: 「回來 1 次」 read oddly,
// and a reset on the hour is the easiest to understand). Pure: no chrome.* here.
export const HOUR_MS=3600000;
/** The meter for a usage record ({stamps}) against an hourly limit. level: 'ok' | 'high' (80% or more) | 'full'. */
export function meter(usage,limit,now=Date.now()){
 const start=Math.floor(now/HOUR_MS)*HOUR_MS,stamps=(Array.isArray(usage?.stamps)?usage.stamps:[]).filter(t=>Number.isFinite(t)&&t>=start&&t<=now);
 const used=Math.min(stamps.length,limit),remaining=limit-used,pct=Math.round(used/limit*100);
 return {used,limit,remaining,pct,level:remaining===0?'full':pct>=80?'high':'ok',resetAt:start+HOUR_MS};
}
const minutes=(t,now)=>Math.max(1,Math.ceil((t-now)/60000));
/** The words beside and under the bar: right = used/limit (Felix 10-26: 「0/10」), caption = what is left and when it resets. */
export function meterText(m,now=Date.now()){
 const right=`${m.used}/${m.limit}`;
 if(!m.used)return {right,caption:`每小時 ${m.limit} 次，整點重設`};
 const reset=`${minutes(m.resetAt,now)} 分鐘後重設`;
 return {right,caption:m.remaining?`還剩 ${m.remaining} 次 · ${reset}`:`這小時用完了 · ${reset}`};
}
