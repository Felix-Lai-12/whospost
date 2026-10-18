import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {similarity,RULE_VERSION} from './analysis.mjs';
export class Store{
 constructor(path,{budgetLimitUsd=1}={}){if(!Number.isFinite(budgetLimitUsd)||budgetLimitUsd<=0)throw new Error('Invalid budget limit');this.budgetLimitUsd=budgetLimitUsd;if(path!==':memory:')mkdirSync(dirname(path),{recursive:true});this.db=new DatabaseSync(path);this.db.exec(`PRAGMA journal_mode=WAL;CREATE TABLE IF NOT EXISTS scans(id TEXT PRIMARY KEY,username TEXT,status TEXT,created_at TEXT,updated_at TEXT,result_json TEXT,provider_state_json TEXT);CREATE TABLE IF NOT EXISTS evidence(id TEXT,author TEXT,kind TEXT,text TEXT,posted_at TEXT,url TEXT,parent_url TEXT,fetched_at TEXT,source TEXT,scan_id TEXT,is_quote INTEGER,is_repost INTEGER,PRIMARY KEY(author,id));CREATE TABLE IF NOT EXISTS cache(key TEXT PRIMARY KEY,result_json TEXT,expires_at TEXT);CREATE TABLE IF NOT EXISTS budget(key TEXT PRIMARY KEY,reserved REAL NOT NULL,actual REAL);`);
 this.db.exec(`CREATE TABLE IF NOT EXISTS observations(observation_id INTEGER PRIMARY KEY,scan_id TEXT,author TEXT,content_id TEXT,observed_at TEXT,source TEXT,evidence_json TEXT);CREATE TABLE IF NOT EXISTS analysis_runs(run_id TEXT PRIMARY KEY,scan_id TEXT,version TEXT,analyzed_at TEXT,result_json TEXT);CREATE INDEX IF NOT EXISTS observations_scan ON observations(scan_id);`);
 // final=1 means the provider bill is settled; only then does the unused part of the reservation stop counting.
 if(!this.db.prepare('PRAGMA table_info(budget)').all().some(c=>c.name==='final'))this.db.exec('ALTER TABLE budget ADD COLUMN final INTEGER NOT NULL DEFAULT 0');
 this.budget={reserve:(key,amount)=>{if(!key||!Number.isFinite(amount)||amount<=0)throw new Error('預算預留參數錯誤');const old=this.db.prepare('SELECT * FROM budget WHERE key=?').get(key);if(old)return {id:key,reservedUsd:old.reserved};this.db.exec('BEGIN IMMEDIATE');try{if(this.budget.summary().committed+amount>this.budgetLimitUsd+1e-8)throw Object.assign(new Error(`本輪 US$${this.budgetLimitUsd} 預算已不足，未啟動新任務。`),{code:'BUDGET_EXCEEDED'});this.db.prepare('INSERT INTO budget(key,reserved) VALUES(?,?)').run(key,amount);this.db.exec('COMMIT');return {id:key,reservedUsd:amount};}catch(e){this.db.exec('ROLLBACK');throw e;}},settle:(key,amount,{final=false}={})=>{if(!Number.isFinite(amount)||amount<0)throw new Error('實際費用無效');const row=this.db.prepare('SELECT * FROM budget WHERE key=?').get(key);if(!row)throw new Error('未找到預算預留');this.db.prepare('UPDATE budget SET actual=?,final=? WHERE key=?').run(amount,final?1:0,key);},summary:()=>{const r=this.db.prepare('SELECT COALESCE(SUM(CASE WHEN final=1 THEN actual ELSE MAX(COALESCE(actual,0),reserved) END),0) committed,COALESCE(SUM(COALESCE(actual,0)),0) spent FROM budget').get();return {limit:this.budgetLimitUsd,committed:Number(r.committed.toFixed(6)),spent:Number(r.spent.toFixed(6))};}};
 }
 create(username){const now=new Date().toISOString(),id=randomUUID();const result={id,status:'queued',progress:'準備查詢公開資料',account:{username,url:`https://www.threads.com/@${username}`,name:null},createdAt:now,completedAt:null,error:null,posts:[],comments:[],score:{value:null,reason:'尚未取得資料',version:RULE_VERSION,coordination:null,repetition:null},coverage:{posts:{requested:10,fetched:0,status:'unavailable'},comments:{requested:50,fetched:0,status:'unavailable'},comparison:{records:0,accounts:0,comparedTargetCount:0},limitations:[]},analysis:{coordination:{status:'unavailable',summary:'尚未分析',groups:[]},repetition:{status:'unavailable',summary:'尚未分析',groups:[]},vocabulary:{status:'unavailable',matches:[],sourceUrl:'https://invade.tw/vocabs'},factChecks:{status:'unavailable',items:[]}}};this.db.prepare('INSERT INTO scans VALUES(?,?,?,?,?,?,?)').run(id,username,'queued',now,now,JSON.stringify(result),JSON.stringify({scanId:id}));return result;}
 get(id){const r=this.db.prepare('SELECT result_json FROM scans WHERE id=?').get(id);return r?JSON.parse(r.result_json):null;}
 update(id,patch){const r={...this.get(id),...patch};this.db.prepare('UPDATE scans SET status=?,updated_at=?,result_json=? WHERE id=?').run(r.status,new Date().toISOString(),JSON.stringify(r),id);return r;}
 getState(id){const r=this.db.prepare('SELECT provider_state_json FROM scans WHERE id=?').get(id);return r?JSON.parse(r.provider_state_json):{};}
 setState(id,state){this.db.prepare('UPDATE scans SET provider_state_json=? WHERE id=?').run(JSON.stringify({...state,scanId:id}),id);}
 pending(){return this.db.prepare("SELECT id FROM scans WHERE status IN ('queued','running')").all().map(r=>r.id);}
 findSaved(username){const rows=this.db.prepare("SELECT result_json FROM scans WHERE username=? AND status='completed' ORDER BY created_at DESC").all(username).map(r=>JSON.parse(r.result_json));return rows.find(r=>r.posts?.length||r.comments?.length)??rows[0]??null;}
 findReusable(username){const r=this.db.prepare("SELECT result_json FROM scans WHERE username=? AND (status IN ('queued','running','failed') OR (status='completed' AND updated_at>?)) ORDER BY created_at DESC LIMIT 1").get(username,new Date(Date.now()-3600000).toISOString());return r?JSON.parse(r.result_json):null;}
 saveEvidence(scanId,rows){const observation=this.db.prepare('INSERT INTO observations(scan_id,author,content_id,observed_at,source,evidence_json) VALUES(?,?,?,?,?,?)');for(const r of rows)if(r.id&&r.author)observation.run(scanId,r.author,r.id,r.fetchedAt??new Date().toISOString(),r.source??'unknown',JSON.stringify(r));const stmt=this.db.prepare('INSERT OR REPLACE INTO evidence VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');for(const r of rows)if(r.id&&r.author)stmt.run(r.id,r.author,r.kind,r.text,r.postedAt,r.url,r.parentUrl??null,new Date().toISOString(),r.source??'unknown',scanId,r.isQuote?1:0,r.isRepost?1:0);}
 comparison(username,targets=[]){
 const eligible=targets.filter(t=>Number.isFinite(Date.parse(t.postedAt))&&typeof t.text==='string');if(!eligible.length)return [];
 const min=new Date(Math.min(...eligible.map(t=>Date.parse(t.postedAt)))-86400000).toISOString(),max=new Date(Math.max(...eligible.map(t=>Date.parse(t.postedAt)))+86400000).toISOString();
 return this.db.prepare('SELECT * FROM evidence WHERE lower(author) != lower(?) AND posted_at BETWEEN ? AND ? ORDER BY posted_at DESC,author,id').all(username,min,max).map(r=>({id:r.id,author:r.author,kind:'comparison',text:r.text,postedAt:r.posted_at,url:r.url,parentUrl:r.parent_url,source:r.source,isQuote:!!r.is_quote,isRepost:!!r.is_repost})).filter(r=>!r.isQuote&&!r.isRepost&&eligible.some(t=>Math.abs(Date.parse(t.postedAt)-Date.parse(r.postedAt))<=86400000&&similarity(t.text,r.text)>=.5)).slice(0,1000);
 }
 saveAnalysis(scanId,result){this.db.prepare('INSERT INTO analysis_runs VALUES(?,?,?,?,?)').run(randomUUID(),scanId,result.score?.version??'unknown',new Date().toISOString(),JSON.stringify(result));}
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

 cacheSet(key,value,ttl=3600000){this.db.prepare('INSERT OR REPLACE INTO cache VALUES(?,?,?)').run(key,JSON.stringify(value),new Date(Date.now()+ttl).toISOString());}
 cacheGet(key){const r=this.db.prepare('SELECT result_json FROM cache WHERE key=? AND expires_at>?').get(key,new Date().toISOString());return r?JSON.parse(r.result_json):null;}
 close(){this.db.close();}
}
