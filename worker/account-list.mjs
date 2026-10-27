import {signalScore,followerCount} from '../shared/signals.mjs';
// The public account list the browser extension downloads (plan-threads-extension-20261021 §2, EXTENSION-SPEC §4.2):
// one entry per scanned account, keyed by the SHA-256 of the lowercase username and never carrying the username
// itself. Built from saved results exactly as the result page reads them (scanView → signalScore), kept in the data
// object's cache table for LIST_TTL; the Worker keeps the JSON at the edge for as long, so the data object builds it
// at most once an hour per data center.
export const LIST_VERSION='signals-v2',LIST_TTL=3600000,LIST_CACHE_KEY=`list:${LIST_VERSION}`;
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
export async function listEntry(scan,{appeals=0,ai=null,updated=null}={}){
 const username=String(scan?.account?.username??'').toLowerCase();
 if(scan?.status!=='completed'||!USERNAME.test(username))return null;
 const score=signalScore(scan),hits=score.items.filter(r=>r.status==='yes').map(r=>r.id),summary=aiSummary(ai,scan);
 return {h:await hashUsername(username),score:score.value,hits,assessed:score.assessed,unknown:score.unknown,evidence:evidenceLevel(hits,summary,appeals),ai:summary,scanId:scan.id,updated:updated??scan.completedAt??scan.createdAt??null,appeals,followers:followerCount(scan.account?.followers)};
}
/** The whole list: the newest completed scan per account, from the cache row when it is fresh. A rebuild reads the
 *  scans table once, then one view and one AI job per account, so it is only ever done once per LIST_TTL. */
export async function accountList(core){
 const cached=core.store.cacheGet(LIST_CACHE_KEY);if(cached)return cached;
 const db=core.store.db,appealCounts=new Map(db.prepare('SELECT h,COUNT(*) AS n FROM appeals GROUP BY h').all().map(r=>[r.h,r.n]));
 const seen=new Set(),accounts=[];
 for(const {id,username,updated_at} of db.prepare("SELECT id,username,updated_at FROM scans WHERE status='completed' ORDER BY created_at DESC").all()){
  const key=String(username??'').toLowerCase();if(!key||seen.has(key))continue;seen.add(key);
  const scan=core.store.scanView(id);if(!scan)continue;
  const entry=await listEntry(scan,{appeals:appealCounts.get(await hashUsername(key))??0,ai:core.aiInspect(id)?.result??null,updated:updated_at});
  if(entry)accounts.push(entry);
 }
 const value={license:LIST_LICENSE,attribution:LIST_ATTRIBUTION,generated:new Date(core.store.now()).toISOString(),version:LIST_VERSION,accounts};
 core.store.cacheSet(LIST_CACHE_KEY,value,LIST_TTL);return value;
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
