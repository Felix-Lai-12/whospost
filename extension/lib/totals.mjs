// The popup's three-cell dashboard (Felix 10-26): 已查詢 (即時查 presses that got an answer), 已分析 (reply authors
// compared against the list) and 已封鎖 (the local blocked list), counted since install and kept in
// chrome.storage.local under 'totals' — on this computer only, never sent. Pure: the background script does the storing.
export const TOTAL_MAX=1e9;
export const emptyTotals=()=>({queried:0,analyzed:0,since:null});
const n=v=>Math.min(TOTAL_MAX,Math.max(0,Math.floor(Number(v)||0)));
/** The totals after adding {queried, analyzed}; 'since' is set by the first count. */
export function addTotals(totals,add,now=Date.now()){
 const t={...emptyTotals(),...(totals&&typeof totals==='object'?totals:{})};
 return {queried:n(t.queried)+n(add?.queried),analyzed:n(t.analyzed)+n(add?.analyzed),since:Number.isFinite(t.since)?t.since:now};
}
/** The three cells, in order. blocked is the local blocked list's size; unknown (unreadable) shows as —, never 0. */
export function dashboardCells(totals,blockedCount){
 const t={...emptyTotals(),...(totals&&typeof totals==='object'?totals:{})};
 return [{id:'queried',label:'你已查詢',value:n(t.queried)},{id:'analyzed',label:'你已分析',value:n(t.analyzed)},{id:'blocked',label:'你已封鎖',value:Number.isInteger(blockedCount)?blockedCount:null}];
}
