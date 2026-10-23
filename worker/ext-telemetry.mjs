import {log} from './log.mjs';
// Anonymous usage reports from the browser extension (EXTENSION-SPEC §3.4 「回報貢獻」, §6.3, §8). Two kinds: one
// 'daily' report per installation per day with that day's local counts (pages seen, authors compared, accounts found
// on the list, flagged, thread observations, replies folded, Trust presses), and one 'dom_broken' when the health
// check tripped. A report carries the extension version, the day and the counts and nothing else: no account, hash,
// URL or installation id, so nothing links two reports. Rows are kept aggregated per (day, version, kind): `reports`
// counts how many came in (daily reports ≈ active installations that day), the counters are summed, and the table
// grows with days × versions, never with installations.
export const KINDS=Object.freeze(['daily','dom_broken']);
export const COUNTERS=Object.freeze(['pages','compared','listed','flagged','thread','collapsed','trusted']);
export const COUNT_MAX=100000,DAY_SKEW=2,SUMMARY_DAYS=14,SUMMARY_DAYS_MAX=90;
const VERSION=/^\d{1,3}\.\d{1,3}\.\d{1,3}$/,DAY=/^\d{4}-\d{2}-\d{2}$/,TAIPEI=8*3600000,DAY_MS=86400000;
/** The calendar date in Taipei for a timestamp, YYYY-MM-DD: the extension tallies by the same day. */
export const taipeiDay=now=>new Date(now+TAIPEI).toISOString().slice(0,10);
const dayIndex=day=>{const t=Date.parse(`${day}T00:00:00Z`);return Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===day?t/DAY_MS:null;};
/** {ok:true,report} holding only the known fields, or {ok:false,code:'INVALID_REPORT'}. The day must be a real date
 *  within DAY_SKEW days of today in Taipei: yesterday's tally arrives on the first page of the next day, nothing older
 *  is wanted. Counters are whole numbers from 0 to COUNT_MAX (a 'dom_broken' report carries none). */
export function parseReport(body,now=Date.now()){
 const bad={ok:false,code:'INVALID_REPORT'};
 if(!body||typeof body!=='object'||Array.isArray(body))return bad;
 const {kind,v,day}=body;
 if(!KINDS.includes(kind)||typeof v!=='string'||!VERSION.test(v)||typeof day!=='string'||!DAY.test(day))return bad;
 const index=dayIndex(day);
 if(index===null||Math.abs(index-dayIndex(taipeiDay(now)))>DAY_SKEW)return bad;
 const report={kind,v,day};
 for(const key of COUNTERS){
  const value=body[key];
  if(kind!=='daily'||value===undefined){report[key]=0;continue;}
  if(!Number.isInteger(value)||value<0||value>COUNT_MAX)return bad;
  report[key]=value;
 }
 return {ok:true,report};
}
export const TELEMETRY_TABLE_SQL=`CREATE TABLE IF NOT EXISTS ext_telemetry(day TEXT NOT NULL,version TEXT NOT NULL,kind TEXT NOT NULL,reports INTEGER NOT NULL DEFAULT 0,${COUNTERS.map(c=>`${c} INTEGER NOT NULL DEFAULT 0`).join(',')},updated_at TEXT NOT NULL,PRIMARY KEY(day,version,kind))`;
/** Adds one report to its (day, version, kind) row. A malformed body is answered as a value (RPC carries no custom
 *  error fields), never stored. A 'dom_broken' report is also logged so Workers Logs shows when the layout changed. */
export function saveReport(core,body){
 const parsed=parseReport(body,core.store.now());
 if(!parsed.ok)return parsed;
 const r=parsed.report,at=new Date(core.store.now()).toISOString();
 core.store.db.prepare(`INSERT INTO ext_telemetry(day,version,kind,reports,${COUNTERS.join(',')},updated_at) VALUES(?,?,?,1,${COUNTERS.map(()=>'?').join(',')},?) ON CONFLICT(day,version,kind) DO UPDATE SET reports=reports+1,${COUNTERS.map(c=>`${c}=MIN(${COUNT_MAX*1000},${c}+excluded.${c})`).join(',')},updated_at=excluded.updated_at`)
  .run(r.day,r.v,r.kind,...COUNTERS.map(c=>r[c]),at);
 if(r.kind==='dom_broken')log('warn','ext.dom_broken',{version:r.v,day:r.day});
 return {ok:true,kind:r.kind};
}
/** The aggregated rows of the last `days` days (today included), newest first: what the admin reads to answer §8. */
export function telemetrySummary(core,days=SUMMARY_DAYS){
 const n=Math.min(SUMMARY_DAYS_MAX,Math.max(1,Math.floor(Number(days)||SUMMARY_DAYS)));
 const since=taipeiDay(core.store.now()-(n-1)*DAY_MS);
 const rows=core.store.db.prepare('SELECT day,version,kind,reports,'+COUNTERS.join(',')+',updated_at FROM ext_telemetry WHERE day>=? ORDER BY day DESC,version,kind').all(since).map(r=>({...r}));
 return {since,days:n,rows};
}
