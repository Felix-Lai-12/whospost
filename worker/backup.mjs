import {BACKUP_TABLES} from './store-object.mjs';
/** Backup layout version: bump when the file layout or manifest shape changes, so a restore tool knows what it reads. */
export const BACKUP_SCHEMA_VERSION=1;
export const BACKUP_PREFIX='backups/',PAGE_SIZE=500,KEEP_DAYS=30;
const DAY_MS=86400000,TAIPEI_OFFSET_MS=8*3600000;
/** Calendar date in Taipei for a timestamp: the nightly run at 20:00 UTC files under the Taipei morning it ran on. */
export const taipeiDate=ms=>new Date(ms+TAIPEI_OFFSET_MS).toISOString().slice(0,10);
/**
 * Copies every table of the data object to R2 as JSON Lines under backups/YYYY-MM-DD/<table>.jsonl plus a
 * manifest.json, reading each table page by page over a rowid cursor, then deletes day folders older than keepDays.
 * Used by the nightly cron and by POST /api/admin/backup. Rerunning on the same day overwrites that day's files.
 */
export async function runBackup({storeStub,bucket,now=Date.now,keepDays=KEEP_DAYS,pageSize=PAGE_SIZE,tables=[...BACKUP_TABLES]}){
 if(!bucket)throw new Error('BACKUPS bucket binding is missing');
 const startedAt=now(),date=taipeiDate(startedAt),folder=`${BACKUP_PREFIX}${date}/`,rows={};
 for(const table of tables){
  const lines=[];let after=0;
  for(;;){
   const page=await storeStub.exportPage(table,after,pageSize);
   for(const {_rowid,...row} of page.rows)lines.push(JSON.stringify(row));
   if(page.next===null)break;
   after=page.next;
  }
  rows[table]=lines.length;
  await bucket.put(`${folder}${table}.jsonl`,lines.length?lines.join('\n')+'\n':'',{httpMetadata:{contentType:'application/x-ndjson'}});
 }
 const manifest={schemaVersion:BACKUP_SCHEMA_VERSION,date,exportedAt:new Date(startedAt).toISOString(),finishedAt:new Date(now()).toISOString(),tables,rows,
  files:Object.fromEntries(tables.map(t=>[t,`${folder}${t}.jsonl`]))};
 await bucket.put(`${folder}manifest.json`,JSON.stringify(manifest,null,1),{httpMetadata:{contentType:'application/json'}});
 const deleted=await pruneBackups({bucket,now,keepDays});
 return {...manifest,deleted};
}
/** Deletes backups/<date>/ folders whose date is more than keepDays before today (Taipei); returns the dates removed. */
export async function pruneBackups({bucket,now=Date.now,keepDays=KEEP_DAYS}){
 const cutoff=taipeiDate(now()-keepDays*DAY_MS),deleted=[];
 for(const prefix of await listPrefixes(bucket,BACKUP_PREFIX)){
  const date=prefix.slice(BACKUP_PREFIX.length,-1);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date>=cutoff)continue;
  const keys=await listKeys(bucket,prefix);
  for(let i=0;i<keys.length;i+=1000)await bucket.delete(keys.slice(i,i+1000));
  deleted.push(date);
 }
 return deleted.sort();
}
async function listPrefixes(bucket,prefix){
 const out=[];let cursor;
 do{const r=await bucket.list({prefix,delimiter:'/',cursor});out.push(...(r.delimitedPrefixes??[]));cursor=r.truncated?r.cursor:undefined;}while(cursor);
 return out;
}
async function listKeys(bucket,prefix){
 const out=[];let cursor;
 do{const r=await bucket.list({prefix,cursor});out.push(...r.objects.map(o=>o.key));cursor=r.truncated?r.cursor:undefined;}while(cursor);
 return out;
}
