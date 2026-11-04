import {BACKUP_TABLES} from './store-object.mjs';
import {log,timer} from './log.mjs';
/** Backup layout version: bump when the file layout or manifest shape changes, so a restore tool knows what it reads. */
export const BACKUP_SCHEMA_VERSION=2;
// Retention: every day for the last KEEP_DAYS days, then the Monday (Taipei) backup for KEEP_WEEKS more weeks,
// about 11 copies in all. R2's free tier is 10 GB and a daily copy grows, so 30 dailies would not fit.
// PAGE_SIZE is the most rows one exportPage call asks for; the data object also stops a page at 4 MiB. Each page is
// one RPC to the data object, which can sit in another region from the cron (about 185 ms a call on 2026-10-31), so
// the page size sets how long the night takes: 25-row pages meant ~4,900 calls for ~500 MB and the run hit the
// 15-minute cron limit from 11-01 on; 500-row pages are ~380 calls.
// PART_BYTES: each table's gzip output goes to R2 as a multipart upload in parts of this size (R2 wants every part
// but the last to be the same size, at least 5 MiB), so a table is never held whole in memory (ai_jobs alone was
// 36 MB gzipped on 10-31, and the Worker has 128 MB).
export const BACKUP_PREFIX='backups/',PAGE_SIZE=500,PART_BYTES=8*1024*1024,KEEP_DAYS=7,KEEP_WEEKS=4;
const DAY_MS=86400000,TAIPEI_OFFSET_MS=8*3600000;
const encoder=new TextEncoder();
/** Calendar date in Taipei for a timestamp: the nightly run at 20:00 UTC files under the Taipei morning it ran on. */
export const taipeiDate=ms=>new Date(ms+TAIPEI_OFFSET_MS).toISOString().slice(0,10);
/**
 * Copies every table of the data object to R2 as gzipped JSON Lines under backups/YYYY-MM-DD/<table>.jsonl.gz
 * plus a manifest.json, reading each table page by page over a rowid cursor, then prunes old day folders (see pruneBackups).
 * Used by the nightly cron and by POST /api/admin/backup. Rerunning on the same day overwrites that day's files.
 */
export async function runBackup({storeStub,bucket,now=Date.now,keepDays=KEEP_DAYS,keepWeeks=KEEP_WEEKS,pageSize=PAGE_SIZE,partBytes=PART_BYTES,tables=[...BACKUP_TABLES]}){
 if(!bucket)throw new Error('BACKUPS bucket binding is missing');
 const startedAt=now(),date=taipeiDate(startedAt),folder=`${BACKUP_PREFIX}${date}/`,rows={},bytes={};
 for(const table of tables){
  const elapsed=timer(),stream=new CompressionStream('gzip'),writer=stream.writable.getWriter();
  // Drain concurrently: backpressure must not deadlock the page writer. At most about one part is buffered.
  const uploaded=uploadStream({bucket,key:`${folder}${table}.jsonl.gz`,readable:stream.readable,partBytes,
   httpMetadata:{contentType:'application/x-ndjson',contentEncoding:'gzip'}});
  let count=0,rawBytes=0,after=0,calls=0,packed;
  try{
   for(;;){
    const page=await storeStub.exportPage(table,after,pageSize);calls++;
    for(const {_rowid,...row} of page.rows){const line=encoder.encode(JSON.stringify(row)+'\n');await writer.write(line);rawBytes+=line.byteLength;count++;}
    if(page.next===null)break;
    if(!Number.isSafeInteger(page.next)||page.next<=after)throw new Error(`non-advancing backup cursor: ${table}`);
    after=page.next;
   }
   await writer.close();packed=await uploaded;
  }catch(e){await writer.abort(e).catch(()=>{});await uploaded.catch(()=>{});throw e;}
  rows[table]=count;
  bytes[table]={raw:rawBytes,gzip:packed.bytes};
  // One line per table, so a run cut off by the cron limit still shows how far it got and what each table cost.
  log('info','backup.table',{table,rows:count,pages:calls,parts:packed.parts,raw:rawBytes,gzip:packed.bytes,durationMs:elapsed()});
 }
 const total=k=>Object.values(bytes).reduce((n,b)=>n+b[k],0);
 const manifest={schemaVersion:BACKUP_SCHEMA_VERSION,date,exportedAt:new Date(startedAt).toISOString(),finishedAt:new Date(now()).toISOString(),tables,rows,bytes,
  totalBytes:{raw:total('raw'),gzip:total('gzip')},compression:'gzip',files:Object.fromEntries(tables.map(t=>[t,`${folder}${t}.jsonl.gz`]))};
 await bucket.put(`${folder}manifest.json`,JSON.stringify(manifest,null,1),{httpMetadata:{contentType:'application/json'}});
 const deleted=await pruneBackups({bucket,now,keepDays,keepWeeks});
 return {...manifest,deleted};
}
/**
 * Reads `readable` to the end and stores it under `key`. Output smaller than one part is a single put; anything
 * larger is a multipart upload whose parts are exactly `partBytes` (the last one shorter), aborted if anything fails.
 * Resolves to {bytes, parts}: parts is 0 for a single put.
 */
export async function uploadStream({bucket,key,readable,partBytes=PART_BYTES,httpMetadata}){
 const reader=readable.getReader(),chunks=[];let held=0,total=0,upload=null;const parts=[];
 const take=n=>{ // the first n held bytes as one array
  const out=new Uint8Array(n);let at=0;
  while(at<n){const c=chunks[0],k=Math.min(c.byteLength,n-at);out.set(c.subarray(0,k),at);at+=k;if(k===c.byteLength)chunks.shift();else chunks[0]=c.subarray(k);}
  held-=n;return out;
 };
 try{
  for(;;){
   const {value,done}=await reader.read();
   if(done)break;
   const chunk=value instanceof Uint8Array?value:new Uint8Array(value);
   chunks.push(chunk);held+=chunk.byteLength;total+=chunk.byteLength;
   while(held>=partBytes){
    upload??=await bucket.createMultipartUpload(key,{httpMetadata});
    parts.push(await upload.uploadPart(parts.length+1,take(partBytes)));
   }
  }
  if(!upload){await bucket.put(key,take(held),{httpMetadata});return {bytes:total,parts:0};}
  if(held>0)parts.push(await upload.uploadPart(parts.length+1,take(held)));
  await upload.complete(parts);
  return {bytes:total,parts:parts.length};
 }catch(e){
  await reader.cancel(e).catch(()=>{});
  if(upload)await upload.abort().catch(()=>{});
  throw e;
 }
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
