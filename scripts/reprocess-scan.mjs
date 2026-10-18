// Offline only: no providers, secrets or paid requests. Back up SQLite before running.
import {Store} from '../server/store.mjs';
import {analyze} from '../server/analysis.mjs';
import {readFile} from 'node:fs/promises';
export async function reprocess(store,id,{vocabularyEntries=[],factChecks}={}){
 const old=store.get(id);if(!old||old.status!=='completed')throw new Error('Completed scan required');
 const evidence=store.evidenceForScan(id);
 const bundle={account:old.account,posts:old.posts??[],comments:old.comments??[],commentsAvailable:old.coverage?.comments?.status!=='unavailable',comparison:evidence.filter(r=>r.author.toLowerCase()!==old.account.username.toLowerCase()),comparedTargetIds:[],vocabularyEntries,factChecks:factChecks??old.analysis?.factChecks,limitations:['使用已保存的公開資料離線重算，沒有重新抓取；協同比較未充分評估。']};
 const next={...old,...analyze(bundle),reprocessedAt:new Date().toISOString(),dataFetchedAt:old.dataFetchedAt??old.completedAt};
 store.db.exec('BEGIN IMMEDIATE');try{store.saveAnalysis(id,old);store.saveAnalysis(id,next);store.update(id,next);store.cacheSet(`scan:${old.account.username}`,next);store.db.exec('COMMIT');}catch(e){store.db.exec('ROLLBACK');throw e;}return next;
}
if(process.argv[1]&&import.meta.url===new URL(`file://${process.argv[1]}`).href){const [db,id,vocab]=process.argv.slice(2);if(!db||!id)throw new Error('Usage: node scripts/reprocess-scan.mjs DATABASE SCAN_ID [VOCAB_JSON]');const store=new Store(db);try{const raw=vocab?JSON.parse(await readFile(vocab,'utf8')):[];const result=await reprocess(store,id,{vocabularyEntries:Array.isArray(raw)?raw:raw.entries??[]});console.log(JSON.stringify({id,version:result.score.version,score:result.score.value,completedAt:result.completedAt,reprocessedAt:result.reprocessedAt}));}finally{store.close();}}
