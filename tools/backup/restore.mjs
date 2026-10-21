import {DatabaseSync} from 'node:sqlite';
import {readFile,mkdir,open,unlink} from 'node:fs/promises';
import {resolve,dirname,basename} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {pathToFileURL} from 'node:url';
import {StoreObjectCore,BACKUP_TABLES} from '../../worker/store-object.mjs';

/** Offline rehearsal only. Creates a new SQLite file, never opens an existing database for writes. */
export async function restoreBackup(folder,output){
 const root=resolve(folder),target=resolve(output);
 if(target===resolve('data/whospost.sqlite'))throw new Error('production database path is forbidden');
 const manifest=JSON.parse(await readFile(resolve(root,'manifest.json'),'utf8'));
 if(manifest.schemaVersion!==2||manifest.compression!=='gzip')throw new Error('unsupported backup format');
 if(!Array.isArray(manifest.tables)||new Set(manifest.tables).size!==manifest.tables.length||[...BACKUP_TABLES].filter(t=>t!=='appeals').some(t=>!manifest.tables.includes(t))||manifest.tables.some(t=>!BACKUP_TABLES.has(t)))throw new Error('incomplete or unknown table set');
 const loaded=new Map();let rawTotal=0,gzipTotal=0;
 for(const table of manifest.tables){
  const expected=`backups/${manifest.date}/${table}.jsonl.gz`;
  if(manifest.files?.[table]!==expected)throw new Error(`unexpected file for ${table}`);
  const packed=await readFile(resolve(root,basename(expected))),raw=gunzipSync(packed);
  if(raw.length!==manifest.bytes?.[table]?.raw||packed.length!==manifest.bytes?.[table]?.gzip)throw new Error(`byte count mismatch: ${table}`);
  rawTotal+=raw.length;gzipTotal+=packed.length;
  const text=raw.toString('utf8');
  if(text&&!text.endsWith('\n'))throw new Error(`truncated JSONL: ${table}`);
  const rows=text?text.slice(0,-1).split('\n').map(line=>JSON.parse(line)):[];
  if(rows.length!==manifest.rows?.[table])throw new Error(`row count mismatch: ${table}`);
  loaded.set(table,rows);
 }
 if(rawTotal!==manifest.totalBytes?.raw||gzipTotal!==manifest.totalBytes?.gzip)throw new Error('total byte count mismatch');
 await mkdir(dirname(target),{recursive:true});
 // Exclusive creation is the guard against both accidental overwrite and a check/open race.
 const handle=await open(target,'wx',0o600);await handle.close();let db;
 try{
  db=new DatabaseSync(target);
  const storage={sql:{exec(sql,...args){const rows=db.prepare(sql).all(...args);return {toArray:()=>rows,one:()=>rows[0]};}},transactionSync(fn){db.exec('BEGIN');try{const v=fn();db.exec('COMMIT');return v;}catch(e){db.exec('ROLLBACK');throw e;}},setAlarm(){}};
  new StoreObjectCore({storage},{WHOSPOST_AI_ENABLED:'0'},{prompt:'offline restore; no generation'});
  storage.transactionSync(()=>{
   for(const [table,rows] of loaded){
    const columns=db.prepare(`PRAGMA table_info(${table})`).all().map(c=>c.name);
    db.exec(`DELETE FROM ${table}`);
    const insert=db.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')})`);
    for(const row of rows){
     if(!row||Array.isArray(row)||Object.keys(row).length!==columns.length||columns.some(c=>!Object.hasOwn(row,c)))throw new Error(`column mismatch: ${table}`);
     insert.run(...columns.map(c=>row[c]));
    }
   }
  });
  const counts=Object.fromEntries(manifest.tables.map(t=>[t,db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n]));
  if(manifest.tables.some(t=>counts[t]!==manifest.rows[t]))throw new Error('restored row counts differ');
  if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('SQLite integrity check failed');
  const foreignKeys=db.prepare('PRAGMA foreign_key_check').all();if(foreignKeys.length)throw new Error('foreign key check failed');
  return {schemaVersion:manifest.schemaVersion,date:manifest.date,rows:counts,totalBytes:manifest.totalBytes,integrity:'ok',foreignKeys:'ok',output:target,limitations:['Backup pages are read at different times; row counts do not prove a point-in-time snapshot.','Version 2 manifests have no cryptographic content digest.']};
 }catch(e){if(db){db.close();db=null;}await unlink(target);throw e;}finally{db?.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 if(process.argv.length!==4){console.error('Usage: node tools/backup/restore.mjs <downloaded-date-folder> <NEW-offline.sqlite>');process.exitCode=1;}
 else try{console.log(JSON.stringify(await restoreBackup(process.argv[2],process.argv[3]),null,2));}catch(e){console.error(e.message);process.exitCode=1;}
}
