// 「回報貢獻」(EXTENSION-SPEC §3.4, §8): what leaves the browser when the switch is on, and when. The content script
// adds what each page contributed — pages seen, authors compared, accounts found on the list, flagged, thread
// observations, replies folded, Trust presses — into one record for the current Taipei day in chrome.storage.local;
// on the first contact of a later day that record goes out as one 'daily' report and a new one starts. 'dom_broken'
// goes out at most once a day. A report carries the extension version, the day and the counts: no account, hash, URL
// or installation id, so nothing links two reports. Pure: the background script does the storing and sending.
import {taipeiDate} from './settings.mjs';
export const REPORT_PATH='/api/list/v1/telemetry';
export const COUNTERS=Object.freeze(['pages','compared','listed','flagged','thread','collapsed','trusted']);
export const COUNT_MAX=100000,PENDING_DAYS=2;
const clamp=v=>Math.min(COUNT_MAX,Math.max(0,Math.floor(Number(v)||0)));
const dayIndex=day=>Math.round(Date.parse(`${day}T00:00:00Z`)/86400000);
export const emptyTally=day=>({day,...Object.fromEntries(COUNTERS.map(k=>[k,0]))});
/** The local record: today's tally, a finished report that could not be posted yet, and when things last went out. */
export const emptyReport=()=>({tally:null,pending:null,brokenDay:null,sentDay:null,sentAt:null});
/** The counters a page added since it last contributed: positive differences only; null when nothing grew. */
export function pageDelta(committed,stats){
 let delta=null;
 for(const k of COUNTERS){const v=clamp(stats?.[k])-clamp(committed?.[k]);if(v>0)(delta??={})[k]=v;}
 return delta;
}
/** Two deltas added together, for the content script's pending batch. */
export function mergeDelta(a,b){const out={...(a??{})};for(const k of COUNTERS)if(b?.[k])out[k]=clamp((out[k]??0)+b[k]);return out;}
/** The daily report for a finished tally: kind, version, day and the counters, nothing else. */
export const dailyPayload=(tally,version)=>({kind:'daily',v:version,day:tally.day,...Object.fromEntries(COUNTERS.map(k=>[k,clamp(tally[k])]))});
export const brokenPayload=(version,now=Date.now())=>({kind:'dom_broken',v:version,day:taipeiDate(now)});
/** Adds a delta (or nothing: a rollover check) to the record for today. Returns {report, send}: send is the report to
 *  post now — the day that just finished, or an earlier one that failed to post and is still within PENDING_DAYS — or
 *  null. A finished day in which no page was seen is dropped, not sent. */
export function addDelta(report,delta,{now=Date.now(),version='0.0.0'}={}){
 const day=taipeiDate(now);
 const r={...emptyReport(),...(report&&typeof report==='object'?report:{})};
 if(r.tally&&(typeof r.tally!=='object'||r.tally.day!==day)){
  if(r.tally.pages>0)r.pending=dailyPayload(r.tally,version);
  r.tally=null;
 }
 if(!r.tally)r.tally=emptyTally(day);
 for(const k of COUNTERS)if(delta?.[k])r.tally[k]=clamp(r.tally[k]+delta[k]);
 if(r.pending&&(!Number.isFinite(dayIndex(r.pending.day))||dayIndex(day)-dayIndex(r.pending.day)>PENDING_DAYS))r.pending=null;
 return {report:r,send:r.pending};
}
/** The record after a report went out. */
export const markSent=(report,payload,now=Date.now())=>({...report,pending:null,sentDay:payload.day,sentAt:now});
/** Whether a dom_broken notice may go out now: at most one per Taipei day. */
export const brokenDue=(report,now=Date.now())=>report?.brokenDay!==taipeiDate(now);
export const markBroken=(report,now=Date.now())=>({...emptyReport(),...(report&&typeof report==='object'?report:{}),brokenDay:taipeiDate(now)});
const md=day=>typeof day==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(day)?`${Number(day.slice(5,7))}/${Number(day.slice(8,10))}`:'';
/** One line for the popup saying exactly what today's report holds so far, and when the last one went out. */
export function tallyText(report){
 const t=report?.tally;
 if(!t)return '今天還沒有累計。';
 const parts=[`今天累計：看了 ${t.pages} 頁`,`比對 ${t.compared} 個帳號`,`清單上 ${t.listed} 個`,`收起 ${t.collapsed} 則`,`信任 ${t.trusted} 次`];
 if(report.sentDay)parts.push(`上次送出 ${md(report.sentDay)}`);
 if(report.pending)parts.push(`${md(report.pending.day)} 的一筆還沒送出`);
 return parts.join(' · ');
}
