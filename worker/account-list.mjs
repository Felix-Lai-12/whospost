import {signalScore,followerCount} from '../shared/signals.mjs';
// The public account list the browser extension downloads (plan-threads-extension-20261021 §2, EXTENSION-SPEC §4.2):
// one entry per scanned account, keyed by the SHA-256 of the lowercase username and never carrying the username
// itself. Built from saved results exactly as the result page reads them (scanView → signalScore), kept in the data
// object's cache table for LIST_TTL; the Worker keeps the JSON at the edge for LIST_EDGE_TTL. Both were an hour, so a
// new result took up to three hours to reach other users with the extension's hourly fetch (Felix 10-27: shorten it);
// now five minutes each, and a rebuild only happens when something the list reads changed (listStamp).
export const LIST_VERSION='signals-v2',LIST_TTL=300000,LIST_CACHE_KEY=`list:${LIST_VERSION}`,LIST_STAMP_KEY=`${LIST_CACHE_KEY}:stamp`;
export const LIST_LICENSE='CC BY-SA 4.0',LIST_ATTRIBUTION='Whospost (https://whospost.felixlai.workers.dev): observed behaviour signals of public Threads accounts, not identity attribution';
const encoder=new TextEncoder(),USERNAME=/^[a-z0-9_.]{1,30}$/,HASH=/^[a-f0-9]{64}$/,SUMMARY_MAX=200,REASON_MAX=500;
/** sha256(lowercase(username)) as hex: the only identity the list carries. The extension hashes the same way. */
export const hashUsername=async username=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(String(username).toLowerCase())))].map(b=>b.toString(16).padStart(2,'0')).join('');
// One evidence level per entry (plan §2.3): rules (at least one of the six signals hit) > ai (a summary) > appeal (someone pressed Trust) > null (checked, nothing to base a label on). `review` (a person
// checked the account) is reserved for a future scans.review_json and would sit above rules.
const evidenceLevel=(hits,ai,appeals)=>hits.length?'rules':ai?'ai':appeals>0?'appeal':null;
/** The first sentence of a ready AI conclusion with every account name removed (any @handle, the username, the display
 *  name), or null when there is no ready conclusion. A conclusion the wording rules flagged is kept too (Felix 10-27: the
 *  popover already says 「AI 判讀，僅供參考」; hiding it left 「無法判斷是否切題」 cases with no summary at all). */
export function aiSummary(ai,scan){
 if(ai?.status!=='ready'||typeof ai.result?.conclusion!=='string')return null;
 let text=ai.result.conclusion.replace(/@[A-Za-z0-9_.]+/g,'該帳號');
 for(const name of [scan.account?.username,scan.account?.name].filter(n=>typeof n==='string'&&n.length>=2))text=text.split(name).join('該帳號');
 const first=text.match(/^[^。！？!?\n]*[。！？!?]?/)?.[0].trim()||text.trim();
 return {summary:first.slice(0,SUMMARY_MAX),version:ai.provenance?.model??null};
}
/** One list entry for a completed scan view; null when the scan is not completed or its username is not a Threads name.
 *  followers is the account's follower count when that scan got one, else null (never 0 for unknown). */
export async function listEntry(scan,{appeals=0,ai=null,updated=null,profile=null}={}){
 const username=String(scan?.account?.username??'').toLowerCase();
 if(scan?.status!=='completed'||!USERNAME.test(username))return null;
 const score=signalScore(scan),hits=score.items.filter(r=>r.status==='yes').map(r=>r.id),summary=aiSummary(ai,scan);
 return {h:await hashUsername(username),score:score.value,hits,assessed:score.assessed,unknown:score.unknown,evidence:evidenceLevel(hits,summary,appeals),ai:summary,scanId:scan.id,updated:updated??scan.completedAt??scan.createdAt??null,appeals,followers:followerCount(scan.account?.followers),profile};
}
/** What the list reads, in a few aggregate queries: completed scans, appeals, AI jobs and profile reports. Equal stamps
 *  mean a rebuild would give the same list. A table missing in a test setup reads as empty. */
export function listStamp(db){
 const one=sql=>{try{return Object.values(db.prepare(sql).get()??{}).join(',');}catch{return '';}};
 return [one("SELECT COUNT(*),MAX(updated_at) FROM scans WHERE status='completed'"),one('SELECT COUNT(*) FROM appeals'),one('SELECT COUNT(*),MAX(updated) FROM ai_jobs'),one('SELECT COUNT(*),MAX(at) FROM profile_reports')].join('|');
}
/** The whole list: the newest completed scan per account, from the cache row when it is fresh. When the row expires and
 *  nothing changed (same listStamp), the old list is kept for another LIST_TTL, same `generated` and ETag; otherwise a
 *  rebuild reads the scans table once, then one view and one AI job per account. */
export async function accountList(core){
 const cached=core.store.cacheGet(LIST_CACHE_KEY);if(cached)return cached;
 const db=core.store.db,stamp=listStamp(db);
 if(core.store.cacheGet(LIST_STAMP_KEY)?.stamp===stamp){
  // The expired row itself is the old list (cacheGet skips expired rows, so it is read directly).
  const row=db.prepare('SELECT result_json FROM cache WHERE key=?').get(LIST_CACHE_KEY);
  if(row){const value=JSON.parse(row.result_json);core.store.cacheSet(LIST_CACHE_KEY,value,LIST_TTL);return value;}
 }
 const shared=sharedProfiles(db),appealCounts=new Map(db.prepare('SELECT h,COUNT(*) AS n FROM appeals GROUP BY h').all().map(r=>[r.h,r.n]));
 const seen=new Set(),accounts=[];
 for(const {id,username,updated_at} of db.prepare("SELECT id,username,updated_at FROM scans WHERE status='completed' ORDER BY created_at DESC").all()){
  const key=String(username??'').toLowerCase();if(!key||seen.has(key))continue;seen.add(key);
  const scan=core.store.scanView(id);if(!scan)continue;
  const entry=await listEntry(scan,{appeals:appealCounts.get(await hashUsername(key))??0,ai:core.aiInspect(id)?.result??null,updated:updated_at,profile:shared.get(key)??null});
  if(entry)accounts.push(entry);
 }
 const value={license:LIST_LICENSE,attribution:LIST_ATTRIBUTION,generated:new Date(core.store.now()).toISOString(),version:LIST_VERSION,accounts};
 core.store.cacheSet(LIST_CACHE_KEY,value,LIST_TTL);core.store.cacheSet(LIST_STAMP_KEY,{stamp},7*86400000);return value;
}
/** Records one "Trust" press as (account hash, installation hash), once: a repeat changes nothing. A recorded appeal
 *  drops the cached list so the next build shows the new count. A malformed body is answered as a value (RPC carries
 *  no custom error fields), never stored. */
export function saveAppeal(core,body){
 const h=body?.h,installHash=body?.installHash,reason=body?.reason??'';
 if(!HASH.test(h??'')||!HASH.test(installHash??'')||typeof reason!=='string'||reason.length>REASON_MAX)return {ok:false,code:'INVALID_APPEAL'};
 const db=core.store.db;
 if(db.prepare('SELECT 1 AS x FROM appeals WHERE h=? AND install_hash=?').get(h,installHash))return {ok:true,recorded:false};
 db.prepare('INSERT INTO appeals(h,install_hash,created_at,reason) VALUES(?,?,?,?)').run(h,installHash,new Date(core.store.now()).toISOString(),reason);
 db.prepare('DELETE FROM cache WHERE key=?').run(LIST_CACHE_KEY);
 return {ok:true,recorded:true};
}

// 帳號背景 in the list (Felix 10-27): when a user presses 「AI 打詐」, the extension sends the place and joined month
// Threads showed that user (extension/lib/profile.mjs reportBody), by scan ID. One row per (account, network address):
// a repeat from the same address replaces its row, so one address is one vote however many installs it has. The list
// carries the most reported place and month, each on its own; a tie goes to the earliest report.
export const PROFILE_TABLE_SQL="CREATE TABLE IF NOT EXISTS profile_reports(username TEXT NOT NULL,reporter TEXT NOT NULL,country TEXT,place TEXT,joined TEXT,at TEXT NOT NULL,PRIMARY KEY(username,reporter))";
const SCAN_ID=/^[a-f0-9-]{36}$/,REPORTER=/^[a-f0-9]{32}$/,PLACE_MAX=60,CONTROL=/[\u0000-\u001f\u007f]/;
/** Records one report; {ok:false, code} for a malformed body, an unknown scan, or a bad reporter. */
export function saveProfileReport(core,body,reporter){
 const b=body&&typeof body==='object'&&!Array.isArray(body)?body:null;
 if(!b||!REPORTER.test(reporter??'')||!SCAN_ID.test(b.scanId??'')||Object.keys(b).some(k=>!['scanId','country','place','joined'].includes(k)))return {ok:false,code:'INVALID_PROFILE'};
 const country=b.country??null,place=b.place??null,joined=b.joined??null,now=new Date(core.store.now());
 if(country!==null&&!/^[A-Z]{2}$/.test(country))return {ok:false,code:'INVALID_PROFILE'};
 if(place!==null&&(typeof place!=='string'||!place.trim()||place.length>PLACE_MAX||CONTROL.test(place)))return {ok:false,code:'INVALID_PROFILE'};
 const m=joined===null?null:String(joined).match(/^(\d{4})-(0[1-9]|1[0-2])$/);
 if(joined!==null&&(!m||Number(m[1])<2003||Number(m[1])*12+Number(m[2])>now.getUTCFullYear()*12+now.getUTCMonth()+1))return {ok:false,code:'INVALID_PROFILE'};
 if(!country&&!place&&!joined)return {ok:false,code:'INVALID_PROFILE'};
 const username=String(core.store.db.prepare('SELECT username FROM scans WHERE id=?').get(b.scanId)?.username??'').toLowerCase();
 if(!USERNAME.test(username))return {ok:false,code:'UNKNOWN_SCAN'};
 core.store.db.prepare('INSERT OR REPLACE INTO profile_reports(username,reporter,country,place,joined,at) VALUES(?,?,?,?,?,?)').run(username,reporter,country,country||place===null?null:place.trim(),joined,now.toISOString());
 return {ok:true};
}
/** username → {country, place, joined, reports}: the most reported place (a code, or Threads' text when there is no
 *  code) and month, each from the reports that have one; reports = how many addresses reported anything. */
export function sharedProfiles(db){
 let rows;try{rows=db.prepare('SELECT username,country,place,joined,at FROM profile_reports ORDER BY at').all();}catch{return new Map();}
 const by=new Map();
 for(const r of rows){const e=by.get(r.username)??{reports:0,place:new Map(),joined:new Map()};e.reports++;
  const where=r.country?`c:${r.country}`:r.place?`p:${r.place}`:null;if(where)e.place.set(where,(e.place.get(where)??0)+1);
  if(r.joined)e.joined.set(r.joined,(e.joined.get(r.joined)??0)+1);by.set(r.username,e);}
 // Map keeps first-seen order (rows are oldest first), so the first key with the top count is the earliest report.
 const top=m=>{let best=null,n=0;for(const [k,c] of m)if(c>n){best=k;n=c;}return best;};
 const out=new Map();
 for(const [u,e] of by){const w=top(e.place);out.set(u,{country:w?.startsWith('c:')?w.slice(2):null,place:w?.startsWith('p:')?w.slice(2):null,joined:top(e.joined),reports:e.reports});}
 return out;
}
/** For the admin: over the accounts on the list (one per username with a completed scan), how many have a shared
 *  background, and the counts by place and by joined year and month. Unknowns are counted apart, never as a place. */
export function profileStats(core){
 const db=core.store.db,shared=sharedProfiles(db);
 const names=new Set(db.prepare("SELECT DISTINCT lower(username) AS u FROM scans WHERE status='completed'").all().map(r=>r.u).filter(u=>USERNAME.test(u??'')));
 const count=(m,k)=>m.set(k,(m.get(k)??0)+1),places=new Map(),years=new Map(),months=new Map();
 let withReport=0,noPlace=0,noJoined=0;
 for(const u of names){const p=shared.get(u);if(!p)continue;withReport++;
  if(p.country||p.place)count(places,p.country??`(${p.place})`);else noPlace++;
  if(p.joined){count(years,p.joined.slice(0,4));count(months,p.joined);}else noJoined++;}
 const sorted=m=>[...m].sort((a,b)=>b[1]-a[1]||String(a[0]).localeCompare(String(b[0]))).map(([key,n])=>({key,n}));
 return {accounts:names.size,withReport,withoutReport:names.size-withReport,noPlace,noJoined,byPlace:sorted(places),byJoinedYear:[...years].sort().map(([key,n])=>({key,n})),byJoinedMonth:[...months].sort().map(([key,n])=>({key,n}))};
}
