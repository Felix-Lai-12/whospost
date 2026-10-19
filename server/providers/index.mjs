import {collectionProfile} from '../collection-profile.mjs';
import vocabulary from '../../data/vocabulary.json' with {type:'json'};
import {createApifyRunner,ProviderError} from './apify.mjs';
// Bills settle after the scan, off its critical path: the host calls one of these once the scan has ended.
export {settleBills,waitAndSettleBills} from './apify.mjs';
import {normalizeAutomation,normalizeAuthoredReply,uniqueRecent,searchTargets,normalizeSupplementPost,relaxedTargets} from './normalize.mjs';
import {fetchFactChecks} from './cofacts.mjs';
export async function fetchAccount(username,{onProgress=()=>{},onState=async()=>{},state={},budget,fetchImpl=globalThis.fetch,sleep,pollMs,maxPolls,profileId='standard',crossAccountSearch=true,token}={}) {
  if(!/^[a-zA-Z0-9_.]{1,30}$/.test(username))throw new ProviderError('INVALID_USERNAME','Threads 帳號格式不正確。');
  username=username.toLowerCase();
  const profile=collectionProfile(profileId);
  const runner=createApifyRunner({token,onState,state,budget,fetchImpl,sleep,pollMs,maxPolls});
  const collection={status:'available',profileId:profile.id,steps:[]};
  const existing=key=>Boolean(state.jobs?.[key]?.runId||state.jobs?.[key]?.dispatched);
  // While any saved dispatch is unconfirmed, no new paid job starts; saved runs still resume and settle.
  const unknownDispatch=Object.values(state.jobs??{}).some(job=>job?.dispatched&&!job.runId);
  // A step is recorded when it starts, so concurrent jobs keep a fixed order.
  const run=async(key,...args)=>{const step={key};collection.steps.push(step);try{if(unknownDispatch&&!existing(key))throw new ProviderError('APIFY_UNKNOWN_RUN','另一個任務的啟動結果不明，請先核對 Apify 工作紀錄；系統不啟動新任務。');const rows=await runner(key,...args);Object.assign(step,{status:'succeeded',recordCount:rows.length});return rows;}catch(e){Object.assign(step,{status:e.code==='BUDGET_EXCEEDED'?'not_executed':'failed',errorCode:e.code??'PROVIDER_FAILED'});throw e;}};
  const bundle={account:{username,url:`https://www.threads.com/@${username}`,name:null},posts:[],comments:[],comparison:[],comparedTargetIds:[],collectionRequest:profile,commentsAvailable:false,limitations:['公開資料為有限取樣，無法代表完整發言歷史；此工具不驗證幕後組織或身分。'],factChecks:{status:'unavailable',items:[]},vocabularyEntries:[]};
  onProgress(`同時讀取最近 ${profile.posts} 則發文與最多 ${profile.replies} 則本人留言`);
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
  const collectPosts=async()=>{
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
  };
  const collectReplies=async()=>{
    try {
      const rows=await run('replies','benthepythondev/threads-user-posts-scraper',{mode:'replies',usernames:[username],maxResults:profile.replies},profile.repliesCapUsd);
      bundle.comments=uniqueRecent(rows.map(r=>normalizeAuthoredReply(r,username)),profile.replies);
      bundle.commentsAvailable=bundle.comments.some(r=>r.parentUrl&&r.parentAuthor&&r.parentAuthor!==username);
      if(bundle.comments.length<profile.replies)replyNotes.push(`只取得 ${bundle.comments.length}/${profile.replies} 則本人留言；不把留言總數當成留言全文。`);
      if(!bundle.commentsAvailable)replyNotes.push('沒有具備父貼文與作者資訊的他人串留言，跨串重複分析不可判定。');
    } catch(e){if(['APIFY_PENDING','APIFY_UNKNOWN_RUN','APIFY_NETWORK','APIFY_AUTH'].includes(e.code))throw e;replyNotes.push(`本人留言資料：${e.message}`);}
  };
  const failures=(await Promise.allSettled([collectPosts(),collectReplies()])).filter(r=>r.status==='rejected').map(r=>r.reason);
  bundle.limitations.push(...postNotes,...replyNotes);
  // Both jobs have stopped by now. A pending one goes first so a resuming host keeps polling it;
  // otherwise the posts error wins, as when the jobs ran one after the other.
  if(failures.length)throw failures.find(e=>e.code==='APIFY_PENDING')??failures[0];
  // Paid cross-account search feeds coordination evidence that is not scored yet; the server keeps it off by default.
  const targets=crossAccountSearch?searchTargets(bundle.posts):[];
  if(!crossAccountSearch)bundle.limitations.push('跨帳號搜尋已關閉，只比對資料庫內已查過的帳號；協同發文尚未評估。');
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
  }else if(collection.steps.some(step=>step.status==='failed'))collection.status='partial';
  bundle.collection=collection;
  onProgress('比對字彙與 Cofacts 相關查核');
  bundle.factChecks=await fetchFactChecks([...bundle.posts,...bundle.comments],{fetchImpl});
  // Bundled with the code so Node and the Worker read the same pinned vocabulary.
  try {bundle.vocabularyEntries=vocabulary.entries;bundle.vocabularyVersion=vocabulary.version;bundle.vocabularyLicense=vocabulary.license;}catch {bundle.limitations.push('字彙資料載入失敗，本次不提供字彙判讀。');}
  return bundle;
}
