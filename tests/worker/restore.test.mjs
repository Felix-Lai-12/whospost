import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {StoreObjectCore} from '../../worker/store-object.mjs';
import {runBackup} from '../../worker/backup.mjs';
import {restoreBackup} from '../../tools/backup/restore.mjs';

test('all backup tables restore to a new isolated database; ledger and AI rows survive; overwrite and corruption fail closed',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'whospost-restore-')),db=new DatabaseSync(':memory:');
 const storage={sql:{exec(sql,...args){const rows=db.prepare(sql).all(...args);return {toArray:()=>rows,one:()=>rows[0]};}},transactionSync(fn){db.exec('BEGIN');try{const v=fn();db.exec('COMMIT');return v;}catch(e){db.exec('ROLLBACK');throw e;}},setAlarm(){}};
 const core=new StoreObjectCore({storage},{},{prompt:'fixture'}),scan=core.store.create('synthetic_restore');
 core.store.update(scan.id,{status:'completed'});core.store.budget.reserve(`${scan.id}:posts`,.15);core.store.budget.settle(`${scan.id}:posts`,.07,{final:true});
 const objects=new Map(),bucket={put:async(k,v)=>{objects.set(k,v);await writeFile(join(folder,k.split('/').at(-1)),v);},list:async()=>({objects:[],delimitedPrefixes:[],truncated:false})};
 const manifest=await runBackup({storeStub:core,bucket,now:()=>Date.parse('2026-10-21T05:00:00Z')});
 const output=join(folder,'restored.sqlite'),result=await restoreBackup(folder,output);
 assert.deepEqual(result.rows,manifest.rows);assert.equal(result.integrity,'ok');
 const restored=new DatabaseSync(output,{readOnly:true});
 assert.deepEqual(restored.prepare('SELECT key,reserved,actual,final FROM budget').all(),db.prepare('SELECT key,reserved,actual,final FROM budget').all());
 assert.deepEqual(restored.prepare('SELECT * FROM ai_meta').all(),db.prepare('SELECT * FROM ai_meta').all());restored.close();
 const before=await readFile(output);await assert.rejects(restoreBackup(folder,output),/EEXIST/);assert.deepEqual(await readFile(output),before);
 manifest.rows.scans++;await writeFile(join(folder,'manifest.json'),JSON.stringify(manifest));
 await assert.rejects(restoreBackup(folder,join(folder,'bad.sqlite')),/row count mismatch/);
 manifest.rows.scans--;manifest.tables=manifest.tables.filter(t=>t!=='scans');await writeFile(join(folder,'manifest.json'),JSON.stringify(manifest));
 await assert.rejects(restoreBackup(folder,join(folder,'missing.sqlite')),/incomplete/);db.close();
});

test('backup pages stop below RPC byte ceiling and advance over large rows',()=>{
 const db=new DatabaseSync(':memory:');const storage={sql:{exec(sql,...args){const rows=db.prepare(sql).all(...args);return {toArray:()=>rows,one:()=>rows[0]};}},transactionSync:fn=>fn(),setAlarm(){}};
 const core=new StoreObjectCore({storage},{},{prompt:'fixture'});
 for(let i=0;i<6;i++){const scan=core.store.create(`large_${i}`);db.prepare('UPDATE scans SET provider_state_json=? WHERE id=?').run(JSON.stringify({payload:'x'.repeat(1024*1024)}),scan.id);}
 let cursor=0,total=0;
 do{const page=core.exportPage('scans',cursor,500);assert.ok(Buffer.byteLength(JSON.stringify(page))<4*1024*1024+1024);assert.ok(page.rows.length>0);total+=page.rows.length;if(page.next===null)break;assert.ok(page.next>cursor);cursor=page.next;}while(true);
 assert.equal(total,6);db.close();
});
