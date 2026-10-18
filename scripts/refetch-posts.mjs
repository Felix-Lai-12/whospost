// Paid, one-off: re-run only the posts job of a completed scan with its collection profile.
// Replies, searches and AI are not re-run; saved replies and comparison evidence are re-analysed.
// Needs explicit spend approval and WHOSPOST_APIFY_LIMIT_USD covering the new reservation. Back up SQLite first.
import {Store} from '../server/store.mjs';
import {readSecret} from '../server/env-file.mjs';
import {analyze} from '../server/analysis.mjs';
import {collectionProfile} from '../server/collection-profile.mjs';
import {createApifyRunner} from '../server/providers/apify.mjs';
import {normalizeSupplementPost,uniqueRecent} from '../server/providers/normalize.mjs';
import {signalScore} from '../shared/signals.mjs';

const ACTOR='benthepythondev/threads-user-posts-scraper',KEY='postsRefetch';

export async function refetchPosts(store,id,{fetchImpl=globalThis.fetch,token=process.env.APIFY_TOKEN,sleep,pollMs,settlePollMs}={}){
 const old=store.get(id);
 if(!old||old.status!=='completed')throw new Error('Completed scan required');
 if(!old.collectionRequest?.id||!Array.isArray(old.authoredReplies))throw new Error('Scan was not collected with an authored-replies profile');
 const profile=collectionProfile(old.collectionRequest.id),username=old.account.username;
 const saved=store.getState(id);
 if(saved.jobs?.[KEY])throw new Error(`${KEY} already exists for this scan; refusing to dispatch again`);
 const run=createApifyRunner({token,fetchImpl,sleep,pollMs,settlePollMs,budget:store.budget,state:{scanId:id,jobs:{}},onState:s=>store.setState(id,{...store.getState(id),jobs:{...store.getState(id).jobs,...s.jobs}})});
 const rows=await run(KEY,ACTOR,{mode:'posts',usernames:[username],maxResults:profile.postsFetch??profile.posts},profile.postsCapUsd);
 const originals=rows.map(r=>normalizeSupplementPost(r,username)).filter(Boolean);
 const posts=uniqueRecent(originals,profile.posts);
 const fullName=rows.find(r=>typeof r.full_name==='string'&&r.full_name.trim())?.full_name??null;
 const account={...old.account,name:old.account.name??fullName};
 const evidence=store.evidenceForScan(id);
 const bundle={account,posts,comments:old.authoredReplies,commentsAvailable:true,collectionRequest:profile,
  comparison:evidence.filter(r=>r.author.toLowerCase()!==username.toLowerCase()),comparedTargetIds:[],vocabularyEntries:[],factChecks:old.analysis?.factChecks,
  limitations:[`貼文於 ${new Date().toISOString().slice(0,10)} 單獨重抓（${rows.length} 列，原創 ${originals.length} 篇，取最新 ${posts.length} 篇）；留言與協同搜尋沿用先前資料，搜尋樣本是依舊的貼文建立。`]};
 const result=analyze(bundle);
 const next={...old,...result,account,postsRefetchedAt:new Date().toISOString(),dataFetchedAt:old.dataFetchedAt??old.completedAt};
 next.score=signalScore(next);
 store.db.exec('BEGIN IMMEDIATE');
 try{store.saveEvidence(id,result.posts);store.update(id,next);store.saveAnalysis(id,next);store.cacheSet(`scan:${username}`,next);store.db.exec('COMMIT');}
 catch(e){store.db.exec('ROLLBACK');throw e;}
 const job=store.getState(id).jobs[KEY],finalUsd=job.usageTotalUsd??null;
 return {id,runId:job.runId,rows:rows.length,originals:originals.length,posts:posts.length,score:next.score.value,finalUsd,usageFinal:job.usageFinal===true};
}

if(process.argv[1]&&import.meta.url===new URL(`file://${process.argv[1]}`).href){
 const [db,id]=process.argv.slice(2);
 if(!db||!id)throw new Error('Usage: WHOSPOST_APIFY_LIMIT_USD=... node scripts/refetch-posts.mjs DATABASE SCAN_ID');
 if(!process.env.APIFY_TOKEN)process.env.APIFY_TOKEN=readSecret('APIFY_TOKEN')??'';
 const store=new Store(db,{budgetLimitUsd:Number(process.env.WHOSPOST_APIFY_LIMIT_USD??1)});
 try{console.log(JSON.stringify(await refetchPosts(store,id)));}finally{store.close();}
}
