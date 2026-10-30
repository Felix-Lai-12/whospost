// Replies the extension read with the user's own Threads session (plan-extension-replies 2026-10-29), P0 shadow mode:
// kept and compared, never shown. A submission is taken only from the network address that requested that scan through
// the extension within REQUESTER_TTL_MS (the same binding as 帳號背景, account-list.mjs saveProfileReport), checked
// against itself (shared/reply-rows.mjs) and spot-checked logged out (server/reply-check.mjs) before it is stored.
// Nothing here reaches a scan, the list, the site's cache or the AI: the admin summary scores each stored submission
// next to the scan's own (Apify) result, which is what decides whether the extension may later replace the paid fetch.
import {REQUESTER_TTL_MS} from '../server/store-core.mjs';
import {analyze} from '../server/analysis.mjs';
import {signalScore} from '../shared/signals.mjs';
import {asAuthoredReplies} from '../shared/reply-rows.mjs';
// One row per (scan, network address): a second submission from the same address replaces the first.
export const EXT_REPLIES_TABLE_SQL="CREATE TABLE IF NOT EXISTS ext_replies(scan_id TEXT NOT NULL,reporter TEXT NOT NULL,username TEXT NOT NULL,at TEXT NOT NULL,rows_json TEXT NOT NULL,verification TEXT NOT NULL,check_json TEXT NOT NULL,PRIMARY KEY(scan_id,reporter))";
const SCAN_ID=/^[a-f0-9-]{36}$/,REPORTER=/^[a-f0-9]{32}$/,VERIFICATIONS=new Set(['passed','failed','unverifiable']);
// How many recent submissions the admin summary lists one by one (the totals cover all of them).
const RECENT=50;
/** Whose replies this address may send for this scan: {ok:true, username}, or {ok:false, code} for an unknown scan
 *  (UNKNOWN_SCAN) or an address that did not request it through the extension within the hour (NOT_REQUESTER). Asked
 *  before the spot check, so a caller that may not submit never makes the server fetch anything. */
export function extRepliesTarget(core,scanId,reporter){
 if(!SCAN_ID.test(scanId??'')||!REPORTER.test(reporter??''))return {ok:false,code:'INVALID_REPLIES'};
 const db=core.store.db,username=String(db.prepare('SELECT username FROM scans WHERE id=?').get(scanId)?.username??'').toLowerCase();
 if(!username)return {ok:false,code:'UNKNOWN_SCAN'};
 if(!db.prepare('SELECT 1 AS x FROM scan_requesters WHERE scan_id=? AND reporter=? AND at>=?').get(scanId,reporter,new Date(core.store.now()-REQUESTER_TTL_MS).toISOString()))return {ok:false,code:'NOT_REQUESTER'};
 return {ok:true,username};
}
/** Stores a checked submission. The Worker has already run both checks; the binding is asked again here because the
 *  spot check took time and the store is the only place that knows. */
export function saveExtReplies(core,{scanId,reporter,rows,verification,checked}){
 const target=extRepliesTarget(core,scanId,reporter);if(!target.ok)return target;
 if(!Array.isArray(rows)||!VERIFICATIONS.has(verification)||!Array.isArray(checked))return {ok:false,code:'INVALID_REPLIES'};
 core.store.db.prepare('INSERT OR REPLACE INTO ext_replies(scan_id,reporter,username,at,rows_json,verification,check_json) VALUES(?,?,?,?,?,?,?)').run(scanId,reporter,target.username,new Date(core.store.now()).toISOString(),JSON.stringify(rows),verification,JSON.stringify(checked));
 return {ok:true};
}
const hits=score=>score.items.filter(i=>i.status==='yes').map(i=>i.id);
/** The six signals as the extension's replies give them: the scan's own posts and account, these replies in place of
 *  the fetched ones, under ext-25, with the same 互相集中 lookup a saved scan gets. */
export function extScore(core,scan,rows){
 const username=String(scan.account?.username??'').toLowerCase();
 const comments=asAuthoredReplies(rows,username);
 const result=analyze({account:scan.account,posts:scan.posts??[],comments,comparison:[],comparedTargetIds:[],collectionRequest:{id:'ext-25'},commentsAvailable:comments.some(r=>r.parentAuthor&&r.parentAuthor!==username),limitations:[]});
 return signalScore(core.store.withMutual({...result,account:scan.account}));
}
/** For the admin: every submission's spot check, and for those whose scan has finished, whether the six signals agree
 *  with the scan's own result (the same hits, signal by signal), with the most recent RECENT listed. */
export function extRepliesSummary(core){
 const db=core.store.db,rows=db.prepare('SELECT scan_id,username,at,rows_json,verification,check_json FROM ext_replies ORDER BY at DESC').all();
 const verification={passed:0,failed:0,unverifiable:0},bySignal={},recent=[];
 let compared=0,agreeing=0,pending=0,parentless=0,replies=0;
 for(const r of rows){
  verification[r.verification]=(verification[r.verification]??0)+1;
  const sent=JSON.parse(r.rows_json);replies+=sent.length;parentless+=sent.filter(x=>x.parentUrl===null).length;
  const scan=core.store.scanView(r.scan_id);let entry=null;
  if(scan?.status!=='completed')pending++;
  else{
   const ext=extScore(core,scan,sent),apify=scan.score,status=s=>Object.fromEntries(s.items.map(i=>[i.id,i.status]));
   const a=status(apify),e=status(ext),agree=hits(apify).join()===hits(ext).join();
   compared++;if(agree)agreeing++;
   for(const id of Object.keys(a)){const k=`${a[id]}→${e[id]}`;bySignal[id]??={};bySignal[id][k]=(bySignal[id][k]??0)+1;}
   entry={apify:hits(apify),ext:hits(ext),agree,apifyComments:scan.comments?.length??0};
  }
  if(recent.length<RECENT)recent.push({scanId:r.scan_id,username:r.username,at:r.at,replies:sent.length,parentless:sent.filter(x=>x.parentUrl===null).length,verification:r.verification,checked:JSON.parse(r.check_json),...(entry??{pending:true})});
 }
 return {submissions:rows.length,replies,parentless,verification,passRate:rows.length?verification.passed/rows.length:null,compared,agreeing,agreementRate:compared?agreeing/compared:null,pending,bySignal,recent};
}
