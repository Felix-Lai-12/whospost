import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {AiStore} from '../../server/ai/store.mjs';
import {AiStoreCore} from '../../server/ai/store-core.mjs';

const plan=(key,username)=>({key,input:{account:{username}}});
const details=(s,sql,...p)=>s.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...p).map(r=>r.detail).join(' | ');

test('account plans, queued jobs and daily AI spend are read through indexes, not the whole table',()=>{
 const s=new AiStore(':memory:',{limitUsd:10});
 s.claim('k1',plan('k1','alice'),1);s.claim('k2',plan('k2','bob'),2);s.claim('k3',plan('k3','alice'),3);
 assert.deepEqual(s.plansForAccount('alice').map(p=>p.key).sort(),['k1','k3']);
 assert.deepEqual(s.plansForAccount('carol'),[]);
 assert.deepEqual(s.queuedKeys(),['k1','k2','k3']);
 assert.match(details(s,'SELECT plan FROM ai_jobs WHERE username=?','alice'),/USING INDEX ai_jobs_username/);
 assert.match(details(s,"SELECT key FROM ai_jobs WHERE status='queued' ORDER BY updated"),/USING (COVERING )?INDEX ai_jobs_status/);
 assert.match(details(s,'SELECT SUM(actual) FROM ai_attempts WHERE dispatched>=?',0),/USING (COVERING )?INDEX ai_attempts_dispatched/);
 s.close();
});

test('a ledger created before the username column finds its existing jobs once reopened, with nothing backfilled',()=>{
 const file=join(mkdtempSync(join(tmpdir(),'whospost-ai-')),'ai.db');
 const old=new DatabaseSync(file);
 old.exec('CREATE TABLE ai_jobs(key TEXT PRIMARY KEY,status TEXT NOT NULL,plan TEXT NOT NULL,updated INTEGER NOT NULL,error TEXT,raw TEXT,projection TEXT,usage TEXT,actual_model TEXT)');
 old.prepare("INSERT INTO ai_jobs(key,status,plan,updated) VALUES(?,'ready',?,1)").run('old',JSON.stringify(plan('old','hkj315')));
 old.close();
 const s=new AiStore(file,{limitUsd:10});
 assert.deepEqual(s.plansForAccount('hkj315').map(p=>p.key),['old']);
 s.claim('new',plan('new','hkj315'),2);
 assert.deepEqual(s.plansForAccount('hkj315').map(p=>p.key).sort(),['new','old']);
 s.close();
});

test('an engine that refuses generated columns still opens and finds account plans by json_extract',()=>{
 const db=new DatabaseSync(':memory:');
 const refusing=new Proxy(db,{get:(t,k)=>k==='exec'?sql=>{if(/GENERATED|ai_jobs\(username\)/.test(sql))throw Error('unsupported');return t.exec(sql);}:typeof t[k]==='function'?t[k].bind(t):t[k]});
 const s=new AiStoreCore(refusing,{limitUsd:10});
 s.claim('k1',plan('k1','alice'),1);
 assert.deepEqual(s.plansForAccount('alice').map(p=>p.key),['k1']);
 assert.deepEqual(s.queuedKeys(),['k1']);
});
