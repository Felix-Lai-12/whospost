// Runtime-neutral AI ledger. Node wraps node:sqlite (server/ai/store.mjs); the Worker wraps Durable Object SQLite.
// admit(reserveMicros, now) lets the host apply an extra cap, such as a daily cap shared with Apify.
export const micros=n=>{if(!Number.isFinite(n)||n<0)throw Error('Invalid AI budget');return Math.ceil(n*1e6);};
export class AiStoreCore{
 constructor(db,{limitUsd,baselineCommittedUsd=0,tx=fn=>fn(),admit=null}){
  this.limit=micros(limitUsd);const baseline=micros(baselineCommittedUsd);
  Object.assign(this,{db,tx,admit});
  db.exec(`CREATE TABLE IF NOT EXISTS ai_meta(id INTEGER PRIMARY KEY,baseline INTEGER NOT NULL);CREATE TABLE IF NOT EXISTS ai_jobs(key TEXT PRIMARY KEY,status TEXT NOT NULL,plan TEXT NOT NULL,updated INTEGER NOT NULL,error TEXT,raw TEXT,projection TEXT,usage TEXT,actual_model TEXT);CREATE TABLE IF NOT EXISTS ai_attempts(key TEXT PRIMARY KEY,reserved INTEGER NOT NULL,actual INTEGER,dispatched INTEGER NOT NULL)`);
  // When the job was requested, for the client's first poll; null on jobs claimed before this column existed.
  try{db.exec('ALTER TABLE ai_jobs ADD COLUMN created INTEGER');}catch{}
  // Account lookups, the queued-job sweep and the daily AI spend each read the whole table without these. username is
  // computed from the plan (virtual: nothing to backfill, every writer stays as it is) so plansForAccount uses an index.
  // An engine without generated columns keeps the json_extract lookup instead of failing to open.
  try{db.exec("ALTER TABLE ai_jobs ADD COLUMN username TEXT GENERATED ALWAYS AS (json_extract(plan,'$.input.account.username')) VIRTUAL");}catch{}
  try{db.exec('CREATE INDEX IF NOT EXISTS ai_jobs_username ON ai_jobs(username)');this.byUsername='username=?';}catch{this.byUsername="json_extract(plan,'$.input.account.username')=?";}
  db.exec('CREATE INDEX IF NOT EXISTS ai_jobs_status ON ai_jobs(status,updated);CREATE INDEX IF NOT EXISTS ai_attempts_dispatched ON ai_attempts(dispatched)');
  // Baseline is seeded only once; reopening must never erase earlier spending.
  db.prepare('INSERT OR IGNORE INTO ai_meta VALUES(1,?)').run(baseline);
 }
 budget(){const baseline=this.db.prepare('SELECT baseline FROM ai_meta WHERE id=1').get().baseline;const spent=this.db.prepare('SELECT COALESCE(SUM(COALESCE(actual,reserved)),0) n FROM ai_attempts').get().n;return {limitUsd:this.limit/1e6,committedUsd:(baseline+spent)/1e6,remainingUsd:Math.max(0,(this.limit-baseline-spent)/1e6)};}
 get(key){const r=this.db.prepare('SELECT * FROM ai_jobs WHERE key=?').get(key);return r?{...r,plan:JSON.parse(r.plan),raw:r.raw?JSON.parse(r.raw):null,projection:r.projection?JSON.parse(r.projection):null,usage:r.usage?JSON.parse(r.usage):null}:null;}
 plansForAccount(username){return this.db.prepare(`SELECT plan FROM ai_jobs WHERE ${this.byUsername}`).all(username).map(r=>JSON.parse(r.plan));}
 claim(key,plan,now){const r=this.db.prepare("INSERT OR IGNORE INTO ai_jobs(key,status,plan,updated,created) VALUES(?,'queued',?,?,?)").run(key,JSON.stringify(plan),now,now);return r.changes===1;}
 counting(key,now){return this.db.prepare("UPDATE ai_jobs SET status='counting',updated=? WHERE key=? AND status='queued'").run(now,key).changes===1;}
 dispatch(key,reserveUsd,now){return this.tx(()=>{
  const job=this.get(key);if(job?.status!=='counting')return false;
  const reserve=micros(reserveUsd),budget=this.budget();
  if(micros(budget.committedUsd)+reserve>this.limit||this.admit&&!this.admit(reserve,now)){this.fail(key,'budget_exceeded',now);return false;}
  this.db.prepare('INSERT INTO ai_attempts VALUES(?,?,NULL,?)').run(key,reserve,now);
  this.db.prepare("UPDATE ai_jobs SET status='generating',updated=? WHERE key=?").run(now,key);return true;
 });}
 settle(key,{raw,usage,actualUsd,projection,status,error,actualModel},now){this.tx(()=>{
  // Only a confirmed usage report releases a reservation. Unknown delivery keeps it.
  if(actualUsd!==null)this.db.prepare('UPDATE ai_attempts SET actual=? WHERE key=?').run(micros(actualUsd),key);
  this.db.prepare('UPDATE ai_jobs SET status=?,updated=?,error=?,raw=?,projection=?,usage=?,actual_model=? WHERE key=?').run(status,now,error??null,raw?JSON.stringify(raw):null,projection?JSON.stringify(projection):null,usage?JSON.stringify(usage):null,actualModel??null,key);
 });}
 /** Publishes a stored rejected output that passes the current rules; spend is untouched. */
 release(key,projection,now){return this.db.prepare("UPDATE ai_jobs SET status='ready',error=NULL,projection=?,updated=? WHERE key=? AND status='invalid'").run(JSON.stringify(projection),now,key).changes===1;}
 fail(key,code,now){this.db.prepare("UPDATE ai_jobs SET status='error',error=?,updated=? WHERE key=?").run(code,now,key);}
 /** The provider refused the request before processing it: drop the reservation so the job can be retried. */
 reject(key,code,now){this.tx(()=>{this.db.prepare('DELETE FROM ai_attempts WHERE key=? AND actual IS NULL').run(key);this.fail(key,code,now);});}
 retryPreflight(key,now){return this.db.prepare("UPDATE ai_jobs SET status='queued',error=NULL,updated=?,created=? WHERE key=? AND status='error' AND error IN ('preflight_failed','budget_exceeded','provider_rejected') AND NOT EXISTS(SELECT 1 FROM ai_attempts WHERE key=?)").run(now,now,key,key).changes===1;}
 queuedKeys(){return this.db.prepare("SELECT key FROM ai_jobs WHERE status='queued' ORDER BY updated").all().map(r=>r.key);}
 // Spend dated by dispatch time, for a daily cap shared with other providers.
 committedSinceUsd(since){return this.db.prepare('SELECT COALESCE(SUM(COALESCE(actual,reserved)),0) n FROM ai_attempts WHERE dispatched>=?').get(since).n/1e6;}
}
