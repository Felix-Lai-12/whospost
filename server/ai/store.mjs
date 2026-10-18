import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,chmodSync} from 'node:fs';
import {dirname} from 'node:path';
const micros=n=>{if(!Number.isFinite(n)||n<0)throw Error('Invalid AI budget');return Math.ceil(n*1e6);};
export class AiStore{
 constructor(path,{limitUsd,baselineCommittedUsd=0}){
  this.limit=micros(limitUsd);const baseline=micros(baselineCommittedUsd);
  if(path!==':memory:')mkdirSync(dirname(path),{recursive:true});
  this.db=new DatabaseSync(path);
  if(this.db.prepare("SELECT name FROM sqlite_master WHERE name='scans'").get()){this.db.close();throw Error('AI ledger must not use the scan database');}
  this.db.exec(`PRAGMA journal_mode=WAL;PRAGMA busy_timeout=3000;
   CREATE TABLE IF NOT EXISTS ai_meta(id INTEGER PRIMARY KEY,baseline INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS ai_jobs(key TEXT PRIMARY KEY,status TEXT NOT NULL,plan TEXT NOT NULL,updated INTEGER NOT NULL,error TEXT,raw TEXT,projection TEXT,usage TEXT,actual_model TEXT);
   CREATE TABLE IF NOT EXISTS ai_attempts(key TEXT PRIMARY KEY,reserved INTEGER NOT NULL,actual INTEGER,dispatched INTEGER NOT NULL);
  `);
  this.db.prepare('INSERT OR IGNORE INTO ai_meta VALUES(1,?)').run(baseline);
  // Baseline is seeded only once; reopening must never erase earlier spending.
  if(path!==':memory:')chmodSync(path,0o600);
 }
 transaction(fn){this.db.exec('BEGIN IMMEDIATE');try{const r=fn();this.db.exec('COMMIT');return r;}catch(e){this.db.exec('ROLLBACK');throw e;}}
 budget(){const baseline=this.db.prepare('SELECT baseline FROM ai_meta WHERE id=1').get().baseline;const spent=this.db.prepare('SELECT COALESCE(SUM(COALESCE(actual,reserved)),0) n FROM ai_attempts').get().n;return {limitUsd:this.limit/1e6,committedUsd:(baseline+spent)/1e6,remainingUsd:Math.max(0,(this.limit-baseline-spent)/1e6)};}
 get(key){const r=this.db.prepare('SELECT * FROM ai_jobs WHERE key=?').get(key);return r?{...r,plan:JSON.parse(r.plan),raw:r.raw?JSON.parse(r.raw):null,projection:r.projection?JSON.parse(r.projection):null,usage:r.usage?JSON.parse(r.usage):null}:null;}
 plansForAccount(username){return this.db.prepare("SELECT plan FROM ai_jobs WHERE json_extract(plan,'$.input.account.username')=?").all(username).map(r=>JSON.parse(r.plan));}
 claim(key,plan,now){const r=this.db.prepare("INSERT OR IGNORE INTO ai_jobs(key,status,plan,updated) VALUES(?,'queued',?,?)").run(key,JSON.stringify(plan),now);return r.changes===1;}
 counting(key,now){return this.db.prepare("UPDATE ai_jobs SET status='counting',updated=? WHERE key=? AND status='queued'").run(now,key).changes===1;}
 dispatch(key,reserveUsd,now){return this.transaction(()=>{
  const job=this.get(key);if(job?.status!=='counting')return false;
  const reserve=micros(reserveUsd),budget=this.budget();
  if(micros(budget.committedUsd)+reserve>this.limit){this.fail(key,'budget_exceeded',now);return false;}
  this.db.prepare('INSERT INTO ai_attempts VALUES(?,?,NULL,?)').run(key,reserve,now);
  this.db.prepare("UPDATE ai_jobs SET status='generating',updated=? WHERE key=?").run(now,key);return true;
 });}
 settle(key,{raw,usage,actualUsd,projection,status,error,actualModel},now){this.transaction(()=>{
  // Only a confirmed usage report releases a reservation. Unknown delivery keeps it.
  if(actualUsd!==null)this.db.prepare('UPDATE ai_attempts SET actual=? WHERE key=?').run(micros(actualUsd),key);
  this.db.prepare('UPDATE ai_jobs SET status=?,updated=?,error=?,raw=?,projection=?,usage=?,actual_model=? WHERE key=?').run(status,now,error??null,raw?JSON.stringify(raw):null,projection?JSON.stringify(projection):null,usage?JSON.stringify(usage):null,actualModel??null,key);
 });}
 fail(key,code,now){this.db.prepare("UPDATE ai_jobs SET status='error',error=?,updated=? WHERE key=?").run(code,now,key);}
 retryPreflight(key,now){return this.db.prepare("UPDATE ai_jobs SET status='queued',error=NULL,updated=? WHERE key=? AND status='error' AND error IN ('preflight_failed','budget_exceeded') AND NOT EXISTS(SELECT 1 FROM ai_attempts WHERE key=?)").run(now,key,key).changes===1;}
 close(){this.db.close();}
}
