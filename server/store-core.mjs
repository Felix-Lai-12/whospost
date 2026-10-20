import {similarity,RULE_VERSION} from './analysis.mjs';
import {coversProfile} from './collection-profile.mjs';
import {signalScore,topReplyTarget} from '../shared/signals.mjs';
// Runtime-neutral store. `db` needs exec(sql) and prepare(sql).{get,all,run}; `tx` runs fn atomically.
// Node wraps node:sqlite (server/store.mjs); the Worker wraps Durable Object SQLite (worker/do-sql.mjs).
const TAIPEI_OFFSET=8*3600000;
export const dayStart=now=>Math.floor((now+TAIPEI_OFFSET)/86400000)*86400000-TAIPEI_OFFSET;
export const dayKey=now=>new Date(dayStart(now)+TAIPEI_OFFSET).toISOString().slice(0,10);
const limitError=(code,message)=>Object.assign(new Error(message),{code});
export class StoreCore{
 constructor(db,{budgetLimitUsd=1,dailyLimitUsd=null,globalScanRatePerMin=null,tx=fn=>fn(),extraDailyUsd=()=>0,now=Date.now}={}){
  if(!Number.isFinite(budgetLimitUsd)||budgetLimitUsd<=0)throw new Error('Invalid budget limit');
  if(dailyLimitUsd!==null&&(!Number.isFinite(dailyLimitUsd)||dailyLimitUsd<=0))throw new Error('Invalid daily limit');
  if(globalScanRatePerMin!==null&&(!Number.isFinite(globalScanRatePerMin)||globalScanRatePerMin<0))throw new Error('Invalid global scan rate');
  Object.assign(this,{db,budgetLimitUsd,dailyLimitUsd,globalScanRatePerMin,tx,extraDailyUsd,now});
  db.exec(`CREATE TABLE IF NOT EXISTS scans(id TEXT PRIMARY KEY,username TEXT,status TEXT,created_at TEXT,updated_at TEXT,result_json TEXT,provider_state_json TEXT);CREATE TABLE IF NOT EXISTS evidence(id TEXT,author TEXT,kind TEXT,text TEXT,posted_at TEXT,url TEXT,parent_url TEXT,fetched_at TEXT,source TEXT,scan_id TEXT,is_quote INTEGER,is_repost INTEGER,PRIMARY KEY(author,id));CREATE TABLE IF NOT EXISTS cache(key TEXT PRIMARY KEY,result_json TEXT,expires_at TEXT);CREATE TABLE IF NOT EXISTS budget(key TEXT PRIMARY KEY,reserved REAL NOT NULL,actual REAL);CREATE TABLE IF NOT EXISTS observations(observation_id INTEGER PRIMARY KEY,scan_id TEXT,author TEXT,content_id TEXT,observed_at TEXT,source TEXT,evidence_json TEXT);CREATE TABLE IF NOT EXISTS analysis_runs(run_id TEXT PRIMARY KEY,scan_id TEXT,version TEXT,analyzed_at TEXT,result_json TEXT);CREATE INDEX IF NOT EXISTS observations_scan ON observations(scan_id);CREATE INDEX IF NOT EXISTS scans_username ON scans(username,status);CREATE INDEX IF NOT EXISTS evidence_posted ON evidence(posted_at);CREATE TABLE IF NOT EXISTS ip_quota(ip TEXT NOT NULL,day TEXT NOT NULL,count INTEGER NOT NULL,PRIMARY KEY(ip,day));CREATE TABLE IF NOT EXISTS scan_requests(id INTEGER PRIMARY KEY,username TEXT NOT NULL,requested_at TEXT NOT NULL,status INTEGER NOT NULL,code TEXT,scan_id TEXT);CREATE INDEX IF NOT EXISTS scan_requests_time ON scan_requests(requested_at);CREATE TABLE IF NOT EXISTS global_scan_rate(bucket INTEGER PRIMARY KEY,count INTEGER NOT NULL)`);
  // final=1 means the provider bill is settled; only then does the unused part of the reservation stop counting.
  // created (ms) dates a reservation for the daily cap; rows from before this column never count toward a day.
  for(const column of ['final INTEGER NOT NULL DEFAULT 0','created INTEGER'])try{db.exec(`ALTER TABLE budget ADD COLUMN ${column}`);}catch{}
  const committedSql='COALESCE(SUM(CASE WHEN final=1 THEN actual ELSE MAX(COALESCE(actual,0),reserved) END),0)';
  this.budget={
   reserve:(key,amount)=>{if(!key||!Number.isFinite(amount)||amount<=0)throw new Error('預算預留參數錯誤');return this.tx(()=>{
    const old=this.db.prepare('SELECT * FROM budget WHERE key=?').get(key);if(old)return {id:key,reservedUsd:old.reserved};
    if(this.budget.summary().committed+amount>this.budgetLimitUsd+1e-8)throw limitError('BUDGET_EXCEEDED','查詢預算已用完，未啟動新任務。每次查詢都要付資料抓取費，歡迎小額捐款 100 元讓專案跑到大選截止：https://whospost.bobaboba.me');
    if(this.dailyLimitUsd!==null&&this.dailyCommittedUsd()+amount>this.dailyLimitUsd+1e-8)throw limitError('BUDGET_EXCEEDED','今天的查詢額度已用完，未啟動新任務。歡迎小額捐款 100 元讓專案跑到大選截止：https://whospost.bobaboba.me');
    this.db.prepare('INSERT INTO budget(key,reserved,created) VALUES(?,?,?)').run(key,amount,this.now());return {id:key,reservedUsd:amount};
   });},
   settle:(key,amount,{final=false}={})=>{if(!Number.isFinite(amount)||amount<0)throw new Error('實際費用無效');const row=this.db.prepare('SELECT * FROM budget WHERE key=?').get(key);if(!row)throw new Error('未找到預算預留');this.db.prepare('UPDATE budget SET actual=?,final=? WHERE key=?').run(amount,final?1:0,key);},
   summary:()=>{const r=this.db.prepare(`SELECT ${committedSql} committed,COALESCE(SUM(COALESCE(actual,0)),0) spent FROM budget`).get();return {limit:this.budgetLimitUsd,committed:Number(r.committed.toFixed(6)),spent:Number(r.spent.toFixed(6))};}
  };
  this.apifyCommittedSince=since=>this.db.prepare(`SELECT ${committedSql} n FROM budget WHERE created>=?`).get(since).n;
 }
 // Apify plus any other spend sharing the daily cap (the AI ledger in the Worker).
 dailyCommittedUsd(){const since=dayStart(this.now());return Number((this.apifyCommittedSince(since)+this.extraDailyUsd(since)).toFixed(6));}
 budgetSummary(){return this.budget.summary();}
 dailySummary(){return this.dailyLimitUsd===null?null:{limit:this.dailyLimitUsd,committed:this.dailyCommittedUsd(),day:dayKey(this.now())};}
 create(username){const now=new Date(this.now()).toISOString(),id=crypto.randomUUID();const result={id,status:'queued',progress:'準備查詢公開資料',account:{username,url:`https://www.threads.com/@${username}`,name:null},createdAt:now,completedAt:null,error:null,posts:[],comments:[],score:{value:null,reason:'尚未取得資料',version:RULE_VERSION,coordination:null,repetition:null},coverage:{posts:{requested:10,fetched:0,status:'unavailable'},comments:{requested:50,fetched:0,status:'unavailable'},comparison:{records:0,accounts:0,comparedTargetCount:0},limitations:[]},analysis:{coordination:{status:'unavailable',summary:'尚未分析',groups:[]},repetition:{status:'unavailable',summary:'尚未分析',groups:[]},vocabulary:{status:'unavailable',matches:[],sourceUrl:'https://invade.tw/vocabs'},factChecks:{status:'unavailable',items:[]}}};this.db.prepare('INSERT INTO scans VALUES(?,?,?,?,?,?,?)').run(id,username,'queued',now,now,JSON.stringify(result),JSON.stringify({scanId:id}));return result;}
 get(id){const r=this.db.prepare('SELECT result_json FROM scans WHERE id=?').get(id);return r?JSON.parse(r.result_json):null;}
 update(id,patch){const r={...this.get(id),...patch};this.db.prepare('UPDATE scans SET status=?,updated_at=?,result_json=? WHERE id=?').run(r.status,new Date(this.now()).toISOString(),JSON.stringify(r),id);return r;}
 getState(id){const r=this.db.prepare('SELECT provider_state_json FROM scans WHERE id=?').get(id);return r?JSON.parse(r.provider_state_json):{};}
 setState(id,state){this.db.prepare('UPDATE scans SET provider_state_json=? WHERE id=?').run(JSON.stringify({...state,scanId:id}),id);}
 pending(){return this.db.prepare("SELECT id FROM scans WHERE status IN ('queued','running')").all().map(r=>r.id);}
 findSaved(username){const rows=this.db.prepare("SELECT result_json FROM scans WHERE username=? AND status='completed' ORDER BY created_at DESC").all(username).map(r=>JSON.parse(r.result_json));return rows.find(r=>r.posts?.length||r.comments?.length)??rows[0]??null;}
 findReusable(username){const r=this.db.prepare("SELECT result_json FROM scans WHERE username=? AND (status IN ('queued','running','failed') OR (status='completed' AND updated_at>?)) ORDER BY created_at DESC LIMIT 1").get(username,new Date(this.now()-3600000).toISOString());return r?JSON.parse(r.result_json):null;}
 saveEvidence(scanId,rows){const observation=this.db.prepare('INSERT INTO observations(scan_id,author,content_id,observed_at,source,evidence_json) VALUES(?,?,?,?,?,?)');for(const r of rows)if(r.id&&r.author)observation.run(scanId,r.author,r.id,r.fetchedAt??new Date(this.now()).toISOString(),r.source??'unknown',JSON.stringify(r));const stmt=this.db.prepare('INSERT OR REPLACE INTO evidence VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');for(const r of rows)if(r.id&&r.author)stmt.run(r.id,r.author,r.kind,r.text,r.postedAt,r.url,r.parentUrl??null,new Date(this.now()).toISOString(),r.source??'unknown',scanId,r.isQuote?1:0,r.isRepost?1:0);}
 comparison(username,targets=[]){
  const eligible=targets.filter(t=>Number.isFinite(Date.parse(t.postedAt))&&typeof t.text==='string');if(!eligible.length)return [];
  const min=new Date(Math.min(...eligible.map(t=>Date.parse(t.postedAt)))-86400000).toISOString(),max=new Date(Math.max(...eligible.map(t=>Date.parse(t.postedAt)))+86400000).toISOString();
  return this.db.prepare('SELECT * FROM evidence WHERE lower(author) != lower(?) AND posted_at BETWEEN ? AND ? ORDER BY posted_at DESC,author,id').all(username,min,max).map(r=>({id:r.id,author:r.author,kind:'comparison',text:r.text,postedAt:r.posted_at,url:r.url,parentUrl:r.parent_url,source:r.source,isQuote:!!r.is_quote,isRepost:!!r.is_repost})).filter(r=>!r.isQuote&&!r.isRepost&&eligible.some(t=>Math.abs(Date.parse(t.postedAt)-Date.parse(r.postedAt))<=86400000&&similarity(t.text,r.text)>=.5)).slice(0,1000);
 }
 saveAnalysis(scanId,result){this.db.prepare('INSERT INTO analysis_runs VALUES(?,?,?,?,?)').run(crypto.randomUUID(),scanId,result.score?.version??'unknown',new Date(this.now()).toISOString(),JSON.stringify(result));}
 evidenceForScan(scanId){
  const observations=this.db.prepare(`SELECT evidence_json FROM (
    SELECT evidence_json,author,content_id,ROW_NUMBER() OVER (
      PARTITION BY lower(ltrim(author,'@')),content_id
      ORDER BY observed_at DESC,observation_id DESC
    ) AS latest FROM observations WHERE scan_id=?
  ) WHERE latest=1 ORDER BY lower(ltrim(author,'@')),content_id`).all(scanId);
  if(observations.length)return observations.map(r=>JSON.parse(r.evidence_json));
  // Legacy scans predate observations; never mix later canonical rows into a snapshot.
  return this.db.prepare('SELECT * FROM evidence WHERE scan_id=? ORDER BY lower(author),id').all(scanId).map(r=>({id:r.id,author:r.author,kind:r.kind,text:r.text,postedAt:r.posted_at,url:r.url,parentUrl:r.parent_url,fetchedAt:r.fetched_at,source:r.source,isQuote:!!r.is_quote,isRepost:!!r.is_repost}));
 }
 cacheSet(key,value,ttl=3600000){this.db.prepare('INSERT OR REPLACE INTO cache VALUES(?,?,?)').run(key,JSON.stringify(value),new Date(this.now()+ttl).toISOString());}
 cacheGet(key){const r=this.db.prepare('SELECT result_json FROM cache WHERE key=? AND expires_at>?').get(key,new Date(this.now()).toISOString());return r?JSON.parse(r.result_json):null;}
 // Mutual concentration needs the partner's saved scan; never fetch it here.
 withMutual(scan){const top=topReplyTarget(scan);if(!top.author||top.share<.5)return scan;const partner=this.findSaved(top.author.toLowerCase());if(!partner)return {...scan,mutual:{partner:top.author,scanned:false}};const p=topReplyTarget(partner);return {...scan,mutual:{partner:top.author,scanned:true,partnerScanId:partner.id,partnerTopAuthor:p.author,partnerShare:p.share}};}
 scanView(id){const found=this.get(id);if(!found)return null;const result=this.withMutual(found);return {...result,score:signalScore(result)};}
 /** Decides a scan request atomically and logs it (account, time, answer) for the admin request list.
  *  Returns {status, body, run?} where run is a scan ID to start. Cache hits are logged too. */
 requestScan(username,profile,options={}){return this.tx(()=>{
  const decision=this.decideScan(username,profile,options);
  this.db.prepare('INSERT INTO scan_requests(username,requested_at,status,code,scan_id) VALUES(?,?,?,?,?)').run(username,new Date(this.now()).toISOString(),decision.status,decision.body?.code??null,decision.body?.id??null);
  return decision;
 });}
 /** requestScan's decision; call only inside its transaction.
  *  quota {ip, max}: new paid work per network address per Taipei day. estimateUsd: caps the new scan may reserve. */
 decideScan(username,profile,{configured=true,quota=null,estimateUsd=0}={}){
  const saved=this.findSaved(username);
  if(saved&&!coversProfile(saved,profile))return {status:409,body:{code:'COLLECTION_PROFILE_MISMATCH',error:'保存資料的查詢範圍較小，未重新抓取。',existingScanId:saved.id,requestedProfile:profile.id}};
  if(saved)return {status:200,body:{id:saved.id,status:'completed',cached:true}};
  if(!configured)return {status:503,body:{error:'尚未設定 Apify token',code:'APIFY_TOKEN_MISSING'}};
  const admit=()=>{
   if(this.budget.summary().committed+estimateUsd>this.budgetLimitUsd+1e-8)return {status:503,body:{code:'BUDGET_EXCEEDED',error:'查詢額度用完了，暫停新查詢；已查過的帳號仍可直接看結果。每次查詢都要付資料抓取費，邀請你小額捐款 100 元讓 Whospost 跑到大選截止：https://whospost.bobaboba.me'}};
   if(this.dailyLimitUsd!==null&&this.dailyCommittedUsd()+estimateUsd>this.dailyLimitUsd+1e-8)return {status:429,body:{code:'DAILY_BUDGET_EXCEEDED',error:'今天的查詢額度已用完，明天再試；已查過的帳號仍可直接看結果。邀請你小額捐款 100 元讓 Whospost 跑到大選截止：https://whospost.bobaboba.me'}};
   // Site-wide new-scan ceiling per minute: a backstop that still holds when the per-IP limit is evaded by
   // spoofing cf-connecting-ip, so forged IPs cannot dispatch unbounded paid scans. Checks run before any
   // counter is written so a later denial never leaves a partial count in the same transaction.
   const minute=Math.floor(this.now()/60000);
   if(this.globalScanRatePerMin>0){const row=this.db.prepare('SELECT count FROM global_scan_rate WHERE bucket=?').get(minute);
    if((row?.count??0)>=this.globalScanRatePerMin)return {status:429,body:{code:'GLOBAL_RATE',error:'全站新查詢量暫時偏高，請稍後再試；已查過的帳號仍可直接看結果。'}};}
   let ipDay=null,ipRow=null;
   if(quota){ipDay=dayKey(this.now());ipRow=this.db.prepare('SELECT count FROM ip_quota WHERE ip=? AND day=?').get(quota.ip,ipDay);
    if((ipRow?.count??0)>=quota.max)return {status:429,body:{code:'DAILY_QUOTA',error:`每個網路位置每天最多 ${quota.max} 次新查詢，明天再試；已查過的帳號仍可直接看結果。`}};}
   if(this.globalScanRatePerMin>0){this.db.prepare('INSERT INTO global_scan_rate(bucket,count) VALUES(?,1) ON CONFLICT(bucket) DO UPDATE SET count=count+1').run(minute);this.db.prepare('DELETE FROM global_scan_rate WHERE bucket<?').run(minute-5);}
   if(quota)this.db.prepare('INSERT INTO ip_quota(ip,day,count) VALUES(?,?,1) ON CONFLICT(ip,day) DO UPDATE SET count=count+1').run(quota.ip,ipDay);
   return null;
  };
  const old=this.findReusable(username);
  if(old){
   if(!coversProfile(old,profile)){const jobs=Object.values(this.getState(old.id).jobs??{});if(old.status==='failed'&&!old.posts?.length&&!old.comments?.length&&!jobs.some(j=>j.runId||j.dispatched))this.update(old.id,{collectionRequest:profile});else return {status:409,body:{code:'COLLECTION_PROFILE_MISMATCH',error:'先前任務的查詢範圍不同，已保留任務，未啟動新抓取。',existingScanId:old.id,requestedProfile:profile.id}};}
   if(old.status==='failed'){const denied=admit();if(denied)return denied;this.retireFailedRuns(old.id);this.update(old.id,{status:'queued',error:null,progress:'恢復先前查詢'});return {status:202,body:{id:old.id,status:'queued',cached:false},run:old.id};}
   return {status:old.status==='completed'?200:202,body:{id:old.id,status:old.status,cached:old.status==='completed'}};
  }
  const denied=admit();if(denied)return denied;
  const scan=this.create(username);this.update(scan.id,{collectionRequest:profile});
  return {status:202,body:{id:scan.id,status:scan.status},run:scan.id};
 }
 /** A run that ended FAILED, TIMED-OUT or ABORTED cannot be resumed, so a scan requested again would only read the same
  *  failure. Move each such job aside (its bill still settles under its own key) so the retry dispatches a new run,
  *  reserved under a new budget key like a released dispatch. Only called on an explicit request, after admit(). */
 retireFailedRuns(id){
  const state=this.getState(id);let changed=false;
  for(const [key,job] of Object.entries(state.jobs??{}))if(job?.runId&&['FAILED','TIMED-OUT','ABORTED'].includes(job.status)){
   const releases=state.releases?.[key]??0;state.jobs[`${key}:failed${releases}`]=job;delete state.jobs[key];state.releases={...state.releases,[key]:releases+1};changed=true;
  }
  if(changed)this.setState(id,state);
 }
 /** Admin view of the request log: per-account totals and the latest rows, newest first. */
 requestLog(limit=500){
  const accounts=this.db.prepare("SELECT username,COUNT(*) requests,SUM(status=200) cached,SUM(status=202) started,MAX(requested_at) lastAt FROM scan_requests GROUP BY username ORDER BY lastAt DESC").all();
  const requests=this.db.prepare('SELECT username,requested_at requestedAt,status,code,scan_id scanId FROM scan_requests ORDER BY id DESC LIMIT ?').all(limit);
  return {accounts:accounts.map(a=>({...a,requests:Number(a.requests),cached:Number(a.cached),started:Number(a.started)})),requests};
 }
}
