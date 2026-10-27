// The popup's three-cell dashboard (Felix 10-27): 已查詢 (即時查 presses that got an answer), 已封鎖 (the local blocked
// list) and 已檢舉 (檢舉 presses that opened Threads' report window; whether the user then sent it, Threads does not tell
// us). Counted since install and kept in chrome.storage.local under 'totals' — on this computer only, never sent.
// 已分析 (authors compared against the list) is gone (Felix 10-27). Pure: the background script does the storing.
export const TOTAL_MAX=1e9;
export const emptyTotals=()=>({queried:0,reported:0,since:null});
const n=v=>Math.min(TOTAL_MAX,Math.max(0,Math.floor(Number(v)||0)));
/** The totals after adding {queried, reported}; 'since' is set by the first count. An old 'analyzed' is dropped. */
export function addTotals(totals,add,now=Date.now()){
 const t={...emptyTotals(),...(totals&&typeof totals==='object'?totals:{})};
 return {queried:n(t.queried)+n(add?.queried),reported:n(t.reported)+n(add?.reported),since:Number.isFinite(t.since)?t.since:now};
}
/** The three cells, in order. blocked is the local blocked list's size; unknown (unreadable) shows as —, never 0. */
export function dashboardCells(totals,blockedCount){
 const t={...emptyTotals(),...(totals&&typeof totals==='object'?totals:{})};
 return [{id:'queried',label:'你已查詢',value:n(t.queried)},{id:'blocked',label:'你已封鎖',value:Number.isInteger(blockedCount)?blockedCount:null},{id:'reported',label:'你已檢舉',value:n(t.reported)}];
}
