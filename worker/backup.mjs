import {BACKUP_TABLES} from './store-object.mjs';
/** Backup layout version: bump when the file layout or manifest shape changes, so a restore tool knows what it reads. */
export const BACKUP_SCHEMA_VERSION=2;
// Retention: every day for the last KEEP_DAYS days, then the Monday (Taipei) backup for KEEP_WEEKS more weeks,
// about 11 copies in all. R2's free tier is 10 GB and a daily copy grows, so 30 dailies would not fit.
export const BACKUP_PREFIX='backups/',PAGE_SIZE=500,KEEP_DAYS=7,KEEP_WEEKS=4;
const DAY_MS=86400000,TAIPEI_OFFSET_MS=8*3600000;
const encoder=new TextEncoder();
const gzip=async text=>new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
/** Calendar date in Taipei for a timestamp: the nightly run at 20:00 UTC files under the Taipei morning it ran on. */
export const taipeiDate=ms=>new Date(ms+TAIPEI_OFFSET_MS).toISOString().slice(0,10);
/**
 * Copies every table of the data object to R2 as gzipped JSON Lines under backups/YYYY-MM-DD/<table>.jsonl.gz
 * plus a manifest.json, reading each table page by page over a rowid cursor, then prunes old day folders (see pruneBackups).
 * Used by the nightly cron and by POST /api/admin/backup. Rerunning on the same day overwrites that day's files.
 */
export async function runBackup({storeStub,bucket,now=Date.now,keepDays=KEEP_DAYS,keepWeeks=KEEP_WEEKS,pageSize=PAGE_SIZE,tables=[...BACKUP_TABLES]}){
 if(!bucket)throw new Error('BACKUPS bucket binding is missing');
 const startedAt=now(),date=taipeiDate(startedAt),folder=`${BACKUP_PREFIX}${date}/`,rows={},bytes={};
 for(const table of tables){
  const lines=[];let after=0;
  for(;;){
   const page=await storeStub.exportPage(table,after,pageSize);
   for(const {_rowid,...row} of page.rows)lines.push(JSON.stringify(row));
   if(page.next===null)break;
   after=page.next;
  }
  rows[table]=lines.length;
  const text=lines.length?lines.join('\n')+'\n':'',packed=await gzip(text);
  bytes[table]={raw:encoder.encode(text).byteLength,gzip:packed.byteLength};
  await bucket.put(`${folder}${table}.jsonl.gz`,packed,{httpMetadata:{contentType:'application/x-ndjson',contentEncoding:'gzip'}});
 }
 const total=k=>Object.values(bytes).reduce((n,b)=>n+b[k],0);
 const manifest={schemaVersion:BACKUP_SCHEMA_VERSION,date,exportedAt:new Date(startedAt).toISOString(),finishedAt:new Date(now()).toISOString(),tables,rows,bytes,
  totalBytes:{raw:total('raw'),gzip:total('gzip')},compression:'gzip',files:Object.fromEntries(tables.map(t=>[t,`${folder}${t}.jsonl.gz`]))};
 await bucket.put(`${folder}manifest.json`,JSON.stringify(manifest,null,1),{httpMetadata:{contentType:'application/json'}});
 const deleted=await pruneBackups({bucket,now,keepDays,keepWeeks});
 return {...manifest,deleted};
}
/** Whether a backup dated `date` is still kept on `today`: any of the last keepDays days, or a Monday (Taipei)
 *  within keepDays+7*keepWeeks days. Today's own folder is always kept. Folders that are not dates are left alone. */
export function keepsBackup(date,today,{keepDays=KEEP_DAYS,keepWeeks=KEEP_WEEKS}={}){
 const age=Math.round((Date.parse(today)-Date.parse(date))/DAY_MS);
 if(age<keepDays)return true;
 return new Date(date).getUTCDay()===1&&age<keepDays+7*keepWeeks;
}
/** Deletes backups/<date>/ folders that keepsBackup no longer wants; returns the dates removed. */
export async function pruneBackups({bucket,now=Date.now,keepDays=KEEP_DAYS,keepWeeks=KEEP_WEEKS}){
 const today=taipeiDate(now()),deleted=[];
 for(const prefix of await listPrefixes(bucket,BACKUP_PREFIX)){
  const date=prefix.slice(BACKUP_PREFIX.length,-1);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||keepsBackup(date,today,{keepDays,keepWeeks}))continue;
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
