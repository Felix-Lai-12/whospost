// The popup's usage meters (Felix 10-26, after Claude's usage page): one bar per hourly allowance, what is left on the
// right, and when the next one comes back. Both allowances are rolling hours, so there is no fixed reset time: the
// oldest press in the last hour is the next one to come back. Pure: no chrome.* here.
export const HOUR_MS=3600000;
/** The meter for a usage record ({stamps}) against an hourly limit. level: 'ok' | 'high' (80% or more) | 'full'. */
export function meter(usage,limit,now=Date.now()){
 const stamps=(Array.isArray(usage?.stamps)?usage.stamps:[]).filter(t=>Number.isFinite(t)&&now-t<HOUR_MS&&t<=now);
 const used=Math.min(stamps.length,limit),remaining=limit-used,pct=Math.round(used/limit*100);
 return {used,limit,remaining,pct,level:remaining===0?'full':pct>=80?'high':'ok',backAt:used?Math.min(...stamps)+HOUR_MS:null};
}
const minutes=(t,now)=>Math.max(1,Math.ceil((t-now)/60000));
/** The words beside and under the bar: right = what is left, caption = the hourly limit and when one comes back. */
export function meterText(m,now=Date.now()){
 if(!m.used)return {right:`剩 ${m.limit} 次`,caption:`每小時 ${m.limit} 次，這小時還沒用`};
 const back=`${minutes(m.backAt,now)} 分鐘後回來 1 次`;
 return m.remaining?{right:`剩 ${m.remaining} 次`,caption:`已用 ${m.used}／${m.limit} · ${back}`}:{right:'用完了',caption:`這小時 ${m.limit} 次用完了 · ${back}`};
}
