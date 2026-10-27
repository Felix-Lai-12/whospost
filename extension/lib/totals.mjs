// The popup's three-cell dashboard (Felix 10-27): AI 打詐 (presses that got an answer), 查詢背景 (presses of the
// 查詢背景 control only, not the background read that comes with AI 打詐) and 封鎖 (the local blocked list), all counts
// of times. Counted since install and kept in chrome.storage.local under 'totals' — on this computer only, never sent.
// The earlier 已分析 and 已檢舉 counts are gone. Pure: the background script does the storing.
export const TOTAL_MAX=1e9;
export const emptyTotals=()=>({queried:0,background:0,since:null});
const n=v=>Math.min(TOTAL_MAX,Math.max(0,Math.floor(Number(v)||0)));
/** The totals after adding {queried, background}; 'since' is set by the first count. Old keys are dropped. */
export function addTotals(totals,add,now=Date.now()){
 const t={...emptyTotals(),...(totals&&typeof totals==='object'?totals:{})};
 return {queried:n(t.queried)+n(add?.queried),background:n(t.background)+n(add?.background),since:Number.isFinite(t.since)?t.since:now};
}
/** The three cells, in order. blocked is the local blocked list's size; unknown (unreadable) shows as —, never 0. */
export function dashboardCells(totals,blockedCount){
 const t={...emptyTotals(),...(totals&&typeof totals==='object'?totals:{})};
 return [{id:'queried',label:'AI 打詐',value:n(t.queried)},{id:'background',label:'查詢背景',value:n(t.background)},{id:'blocked',label:'封鎖',value:Number.isInteger(blockedCount)?blockedCount:null}];
}
