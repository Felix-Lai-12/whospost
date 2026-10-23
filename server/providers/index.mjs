import {collectionProfile} from '../collection-profile.mjs';
import vocabulary from '../../data/vocabulary.json' with {type:'json'};
import {createApifyRunner,ProviderError} from './apify.mjs';
import {BROWSER_CODES} from './browser.mjs';
import {log} from '../../worker/log.mjs';
// Bills settle after the scan, off its critical path: the host calls one of these once the scan has ended.
export {settleBills,waitAndSettleBills} from './apify.mjs';
import {normalizeAutomation,normalizeAuthoredReply,uniqueRecent,searchTargets,normalizeSupplementPost,relaxedTargets} from './normalize.mjs';
import {fetchFactChecks} from './cofacts.mjs';
// Browser time is billed at US$0.09 an hour beyond the plan's included hours. One round reserves the price of
// about 80 seconds and settles at once with what it used, so the ledger, the daily cap and the admin spend
// list see browser scans without any change of their own.
export const BROWSER_CAP_USD=.002,BROWSER_USD_PER_SECOND=.09/3600;
const browserUsd=seconds=>Number((Math.max(0,seconds||0)*BROWSER_USD_PER_SECOND).toFixed(6));
/**
 * Fetches one account's public posts and replies, then the shared tail (comparison corpus, Cofacts, vocabulary).
 * `browser` (a createBrowserFetcher instance) makes the browser provider the first choice; when its round fails
 * (BROWSER_* codes, or fewer than `minPosts` posts) `fallback` decides: 'apify' runs the Apify jobs instead,
 * 'fail' throws. Without `browser` the Apify jobs run as before. bundle.collection.provider names the one that
 * produced the rows.
 */
// Shown when the paid cross-account search is off; the scan runner swaps it for LOCAL_COMPARISON_OFF_NOTE when the
// local comparison is off too.
export const CROSS_SEARCH_OFF_NOTE='跨帳號搜尋已關閉，只比對資料庫內已查過的帳號；協同發文尚未評估。';
// onQuick({name, posts, comments}) receives the browser round's quick sample in hybrid mode (EXTENSION-SPEC §4.3 快篩):
// the posts plus the Replies tab's first page (about ten replies, logged out), as soon as that round ends and while the
// Apify replies job is still running. The caller scores it as a provisional result; bundle.comments stay Apify's.
export async function fetchAccount(username,{onProgress=()=>{},onPartial=()=>{},onQuick=null,onState=async()=>{},state={},budget,fetchImpl=globalThis.fetch,waitSecs,maxPolls,profileId='standard',crossAccountSearch=true,token,provider,browser=null,fallback='apify',minPosts=1,deferFactChecks=false}={}) {
  if(!/^[a-zA-Z0-9_.]{1,30}$/.test(username))throw new ProviderError('INVALID_USERNAME','Threads 帳號格式不正確。');
  username=username.toLowerCase();
  const profile=collectionProfile(profileId);
  const runner=createApifyRunner({token,onState,state,budget,fetchImpl,waitSecs,maxPolls});
  const collection={status:'available',profileId:profile.id,provider:'apify',steps:[]};
  const existing=key=>Boolean(state.jobs?.[key]?.runId||state.jobs?.[key]?.dispatched);
  // While any saved dispatch is unconfirmed, no new paid job starts; saved runs still resume and settle.
  const unknownDispatch=Object.values(state.jobs??{}).some(job=>job?.dispatched&&!job.runId);
  // A step is recorded when it starts, so concurrent jobs keep a fixed order.
  const run=async(key,...args)=>{const step={key};collection.steps.push(step);try{if(unknownDispatch&&!existing(key))throw new ProviderError('APIFY_UNKNOWN_RUN','另一個任務的啟動結果不明，請先核對 Apify 工作紀錄；系統不啟動新任務。');const rows=await runner(key,...args);Object.assign(step,{status:'succeeded',recordCount:rows.length});return rows;}catch(e){Object.assign(step,{status:e.code==='BUDGET_EXCEEDED'?'not_executed':'failed',errorCode:e.code??'PROVIDER_FAILED'});throw e;}};
  const bundle={account:{username,url:`https://www.threads.com/@${username}`,name:null},posts:[],comments:[],comparison:[],comparedTargetIds:[],collectionRequest:profile,commentsAvailable:false,limitations:['公開資料為有限取樣，無法代表完整發言歷史；此工具不驗證幕後組織或身分。'],factChecks:{status:'unavailable',items:[]},vocabularyEntries:[]};
  // Provider modes. 'apify': the posts and replies jobs as before. 'browser': one Browser Rendering round reads
  // both (logged out, about ten replies at most). 'hybrid': the browser round reads the posts, and the Replies tab's
  // first page only as a quick sample for onQuick (never the result's comments); the Apify replies job runs beside it,
  // so the reply signals keep their full sample while the posts cost browser time.
  // A browser failure (BROWSER_* codes, or fewer than minPosts posts) falls back to the Apify posts job (and in
  // 'browser' mode the replies job too) when fallback is 'apify', else fails the scan.
  const mode=provider??(browser?'browser':'apify');
  if(mode!=='apify'&&!browser)throw new ProviderError('BROWSER_LAUNCH','沒有可用的瀏覽器工作階段。');
  collection.provider=mode;
  // One browser round: one step, one reservation settled at once from the seconds used. replies: true reads the
  // Replies tab into the result; 'quick' reads it for onQuick only; false skips it.
  const browserRound=async({replies})=>{
    const quick=replies==='quick';
    const step={key:'browser'};collection.steps.push(step);
    if(!budget?.reserve||!budget?.settle)throw new ProviderError('BUDGET_REQUIRED','缺少持久化費用限制。');
    const budgetKey=`${state.scanId||'single-round'}:browser`;
    await budget.reserve(budgetKey,BROWSER_CAP_USD);
    let out;
    try{out=await browser(username,{profile,onPartial:quick?p=>{if(!('comments' in p))onPartial(p);}:onPartial,scanId:state.scanId,replies:Boolean(replies)});}
    catch(e){
      // Unknown usage keeps the full reservation; a failed settlement must block fallback.
      if(Number.isFinite(e.meta?.browserSeconds))await budget.settle(budgetKey,browserUsd(e.meta.browserSeconds),{final:true});
      Object.assign(step,{status:'failed',errorCode:e.code??'BROWSER_FAILED'});throw e;
    }
    await budget.settle(budgetKey,browserUsd(out.meta?.browserSeconds),{final:true});
    if(out.posts.length<minPosts){Object.assign(step,{status:'failed',errorCode:'BROWSER_SHORT',recordCount:out.posts.length});throw Object.assign(new ProviderError('BROWSER_SHORT',`只讀到 ${out.posts.length} 則發文，少於門檻 ${minPosts}。`),{meta:out.meta});}
    Object.assign(step,{status:'succeeded',recordCount:out.posts.length+out.comments.length,browserSeconds:out.meta?.browserSeconds});
    bundle.account.name=out.name;bundle.posts=out.posts;
    if(bundle.posts.length<profile.posts)bundle.limitations.push(`只取得 ${bundle.posts.length}/${profile.posts} 則發文；缺少資料不視為低風險。`);
    if(quick){onQuick?.({name:out.name,posts:out.posts,comments:out.comments??[]});return;}
    if(!replies)return;
    // The Replies tab is read logged out, which shows about the ten most recent replies, so fewer than
    // profile.replies is the rule rather than a failure.
    bundle.comments=out.comments;
    bundle.commentsAvailable=bundle.comments.some(r=>r.parentUrl&&r.parentAuthor&&r.parentAuthor!==username);
    if(bundle.comments.length<profile.replies)bundle.limitations.push(`未登入狀態下 Threads 只提供最近約 10 則本人留言，本次取得 ${bundle.comments.length}/${profile.replies} 則；不把留言總數當成留言全文。`);
    if(out.meta?.repliesError)bundle.limitations.push(`本人留言資料：讀取回覆分頁失敗（${out.meta.repliesError}）。`);
    if(!bundle.commentsAvailable)bundle.limitations.push('沒有具備父貼文與作者資訊的他人串留言，跨串重複分析不可判定。');
  };
  const primary='benthepythondev/threads-user-posts-scraper';
  // Existing paid jobs retain their keys and actors. Resume their datasets only;
  // never replace them with another primary/supplementary dispatch.
  const postJobs=[];
  if(existing('posts'))postJobs.push({key:'posts',actor:state.jobs.posts.actor||'automation-lab/threads-scraper',legacy:state.jobs.posts.actor!==primary});
  if(existing('postsSupplement'))postJobs.push({key:'postsSupplement',actor:primary,legacy:false});
  if(!postJobs.length)postJobs.push({key:'posts',actor:primary,legacy:false});
  // Posts and replies are independent paid jobs, so they run at the same time. Each keeps its own notes,
  // so limitations stay in the same order whichever job finishes first.
  const postNotes=[],replyNotes=[];
  const apifyPosts=async()=>{
    for(const job of postJobs){
      try {
        const rows=await run(job.key,job.actor,job.legacy?{mode:'posts',usernames:[username],maxPosts:profile.postsFetch??profile.posts,includeProfile:true}:{mode:'posts',usernames:[username],maxResults:profile.postsFetch??profile.posts},job.legacy ? .15 : profile.postsCapUsd);
        const accountProfile=rows.find(r=>r.type==='profile'&&String(r.username).toLowerCase()===username);
        if(accountProfile)bundle.account.name=typeof accountProfile.fullName==='string'?accountProfile.fullName:null;
        const normalized=rows.map(row=>job.legacy?normalizeAutomation(row):normalizeSupplementPost(row,username)).filter(row=>row&&row.author===username&&!row.isReply);
        bundle.posts=uniqueRecent([...bundle.posts,...normalized],profile.posts);
      }catch(e){if(['APIFY_TOKEN_MISSING','APIFY_AUTH','BUDGET_REQUIRED','APIFY_PENDING','APIFY_UNKNOWN_RUN','APIFY_NETWORK'].includes(e.code))throw e;postNotes.push(`發文資料：${e.message}`);}
    }
    if(bundle.posts.length<profile.posts)postNotes.push(`只取得 ${bundle.posts.length}/${profile.posts} 則發文；缺少資料不視為低風險。`);
    // Partial view only: shown while the scan runs, never scored or analysed.
    onPartial({account:{name:bundle.account.name},posts:bundle.posts});
  };
  const apifyReplies=async()=>{
    try {
      const rows=await run('replies','benthepythondev/threads-user-posts-scraper',{mode:'replies',usernames:[username],maxResults:profile.replies},profile.repliesCapUsd);
      bundle.comments=uniqueRecent(rows.map(r=>normalizeAuthoredReply(r,username)),profile.replies);
      bundle.commentsAvailable=bundle.comments.some(r=>r.parentUrl&&r.parentAuthor&&r.parentAuthor!==username);
      if(bundle.comments.length<profile.replies)replyNotes.push(`只取得 ${bundle.comments.length}/${profile.replies} 則本人留言；不把留言總數當成留言全文。`);
      if(!bundle.commentsAvailable)replyNotes.push('沒有具備父貼文與作者資訊的他人串留言，跨串重複分析不可判定。');
    } catch(e){if(['APIFY_PENDING','APIFY_UNKNOWN_RUN','APIFY_NETWORK','APIFY_AUTH'].includes(e.code))throw e;replyNotes.push(`本人留言資料：${e.message}`);}
    onPartial({comments:bundle.comments});
  };
  // Runs the collection tasks together and reports their failures the way the Apify jobs always did: a pending
  // one goes first so a resuming host keeps polling it; otherwise the first failure wins.
  const together=async tasks=>{
    const failures=(await Promise.allSettled(tasks)).filter(r=>r.status==='rejected').map(r=>r.reason);
    bundle.limitations.push(...postNotes,...replyNotes);
    if(failures.length)throw failures.find(e=>e.code==='APIFY_PENDING')??failures[0];
  };
  // After a browser failure: the Apify posts job (and, in browser mode, the replies job) or the scan fails.
  const fallbackFrom=async(e,{withReplies})=>{
    const code=e.code??'BROWSER_FAILED';
    if(!BROWSER_CODES.has(code)&&code!=='BROWSER_SHORT')throw e;
    if(fallback!=='apify'){bundle.limitations.push(`瀏覽器讀取失敗（${code}）：${e.message}`);e.collection={...collection,status:'failed'};throw e;}
    log('info','browser.fallback',{scanId:state.scanId,username,code,posts:e.meta?.posts??null});
    bundle.posts=[];bundle.account.name=null;
    bundle.limitations.push(`瀏覽器讀取失敗（${code}），發文改用 Apify 取數。`);
    if(withReplies){bundle.comments=[];collection.provider='apify';await together([apifyPosts(),apifyReplies()]);}
    else await apifyPosts();
  };
  // Saved Apify posts jobs mean an earlier attempt already ran Apify for the posts (a fallback, or a resumed
  // Apify scan): resume them rather than paying for a browser round whose result would be thrown away.
  const apifyPostsSaved=existing('posts')||existing('postsSupplement');
  if(mode==='apify'||(mode==='browser'&&Object.keys(state.jobs??{}).length)||(mode==='hybrid'&&apifyPostsSaved)){
    if(mode!=='apify')collection.provider=mode==='browser'?'apify':'hybrid';
    onProgress(`同時讀取最近 ${profile.posts} 則發文與最多 ${profile.replies} 則本人留言`);
    await together([apifyPosts(),apifyReplies()]);
  }else if(mode==='browser'){
    onProgress(`從 Threads 公開頁讀取最近 ${profile.posts} 則發文與本人留言`);
    try{await browserRound({replies:true});}catch(e){await fallbackFrom(e,{withReplies:true});}
  }else{
    onProgress(`從 Threads 公開頁讀取最近 ${profile.posts} 則發文，同時讀取最多 ${profile.replies} 則本人留言`);
    await together([browserRound({replies:onQuick?'quick':false}).catch(e=>fallbackFrom(e,{withReplies:false})),apifyReplies()]);
  }
  // Paid cross-account search feeds coordination evidence that is not scored yet; the server keeps it off by default.
  const targets=crossAccountSearch?searchTargets(bundle.posts):[];
  if(!crossAccountSearch)bundle.limitations.push(CROSS_SEARCH_OFF_NOTE);
  else if(targets.length) {
    onProgress('搜尋最多 5 則發文的相近文字，建立協同比較樣本');
    try {
      const rows=await run('search','automation-lab/threads-scraper',{mode:'search',searchQueries:targets.map(t=>t.query),searchSort:'recent',maxPosts:10,includeProfile:false},.30);
      bundle.comparison=uniqueRecent(rows.map(r=>normalizeAutomation(r,'comparison')).filter(p=>p&&p.author!==username),50);
      // A successful search request is not evidence of comparison coverage when no other-author record was returned.
      if(bundle.comparison.length)bundle.comparedTargetIds=targets.map(t=>t.id);
      bundle.limitations.push('協同比較只涵蓋最多 5 個查詢、50 則公開搜尋結果；搜尋排序與可見範圍可能漏掉相關發言。');
    }catch(e){if(['APIFY_PENDING','APIFY_UNKNOWN_RUN','APIFY_NETWORK','APIFY_AUTH'].includes(e.code))throw e;bundle.limitations.push(`比較語料：${e.message}`);}
  }else bundle.limitations.push('沒有長度足夠的原創發文可建立搜尋樣本。');
  if(crossAccountSearch&&new Set(bundle.comparison.map(r=>r.author)).size<2){
    const candidates=relaxedTargets([...bundle.posts,...bundle.comments.filter(r=>r.parentAuthor&&r.parentAuthor!==username)]);
    if(candidates.length){
      onProgress('以關鍵詞擴充比較樣本，再比對完整文字與時間');
      try {const rows=await run('searchRelaxed','automation-lab/threads-scraper',{mode:'search',searchQueries:candidates.map(t=>t.query),searchSort:'recent',maxPosts:5,includeProfile:false},.20);
        bundle.comparison=uniqueRecent([...bundle.comparison,...rows.map(r=>normalizeAutomation(r,'comparison')).filter(r=>r&&r.author!==username)],75);
        if(bundle.comparison.length)bundle.comparedTargetIds=[...new Set([...bundle.comparedTargetIds,...candidates.map(t=>t.id)])];
        bundle.limitations.push('追加最多 5 組關鍵詞搜尋；搜尋結果僅作候選，須通過完整文字相似度及 10 分鐘時間條件才算協同。');
      }catch(e){if(['APIFY_PENDING','APIFY_UNKNOWN_RUN','APIFY_NETWORK','APIFY_AUTH'].includes(e.code))throw e;bundle.limitations.push(`關鍵詞比較：${e.message}`);}
    }
  }
  const blocked=collection.steps.filter(step=>step.errorCode==='BUDGET_EXCEEDED');
  if(blocked.length){
    collection.status=collection.steps.some(step=>step.status==='succeeded')?'partial':'blocked';
    collection.errorCode='BUDGET_EXCEEDED';
    collection.reason='部分或全部取數因本輪預算不足而未執行，不能據此判定帳號沒有內容。';
    if(!bundle.posts.length&&!bundle.comments.length){const error=new ProviderError('BUDGET_EXCEEDED','本輪預算不足，未取得可分析資料；尚未完成帳號取數。');error.collection=collection;throw error;}
    bundle.limitations.push(collection.reason);
  }else if(collection.steps.some(step=>step.status==='failed')){
    collection.status='partial';
    // Nothing came back because a job failed, not because the account is empty. A completed empty result would be
    // served from the cache forever, so fail the scan instead: asking again retries the failed jobs.
    if(!bundle.posts.length&&!bundle.comments.length){collection.status='failed';const error=new ProviderError('PROVIDER_FAILED','取數失敗，未取得可分析資料。');error.collection=collection;throw error;}
  }
  bundle.collection=collection;
  // deferFactChecks hands the Cofacts lookup back to the caller, which can run it while other work (AI) starts.
  const lookupFactChecks=()=>fetchFactChecks([...bundle.posts,...bundle.comments],{fetchImpl});
  if(deferFactChecks)bundle.lookupFactChecks=lookupFactChecks;
  else{onProgress('比對字彙與 Cofacts 相關查核');bundle.factChecks=await lookupFactChecks();}
  // Bundled with the code so Node and the Worker read the same pinned vocabulary.
  try {bundle.vocabularyEntries=vocabulary.entries;bundle.vocabularyVersion=vocabulary.version;bundle.vocabularyLicense=vocabulary.license;}catch {bundle.limitations.push('字彙資料載入失敗，本次不提供字彙判讀。');}
  return bundle;
}
