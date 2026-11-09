// The replies read in the content script (0.2.0, lib/replies.mjs): one account per 「AI 打詐」 press, started at the
// press and sent to the site once the scan id is known (plan-extension-replies 10-30 處理順序 2). Same origin, the
// user's own session: the hover card for the user id (as 帳號背景 does), then one page of the Replies tab; a parent
// Threads hides from this user is read again logged out (credentials omitted), at most PARENT_FILL_MAX of them.
// Pacing, the hourly cap and the stop rule are 帳號背景's (background profileSlot / profileOutcome): one slot per
// account, shared by the two requests. Nothing here draws or blocks; the engine only awaits the promise.
// The query id (11-09, lib/replies.mjs docIdFromScript): read from Threads' own scripts once per tab per DOC_TTL —
// this page's first (it carries the module only on a Replies tab), else the account's /replies page, signed in, and
// the scripts it loads (measured 11-09: 660 KB of HTML, 16 scripts mostly from the cache, under a second); the
// site's id when neither has it, then DEFAULT_DOC_ID. The scripts are read as text for the digits, never run.
import {pageTokens,hovercardRequest,parseHovercard,statusKind} from './profile.mjs';
import {pageRelay,queryOf,repliesRequest,parseReplies,hiddenCodes,parentFromPostPage,withParent,submission,refused,PARENT_FILL_MAX,docIdFromScript,bundleUrls,htmlScriptUrls,dataScript} from './replies.mjs';
export const DOC_TTL=3600000,DOC_BUDGET=8000;
export function createRepliesReader({runtime,doc=document,perf=globalThis.performance,fetchImpl=(...a)=>globalThis.fetch(...a),now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms))}){
 const scripts=()=>[...doc.querySelectorAll('script:not([src])')].map(s=>s.textContent).join('\n');
 // What the last look found (an id, or null for nothing), kept for DOC_TTL so a tab looks at most once an hour.
 let seen=null;
 async function firstDocId(urls,until){
  for(const url of urls){
   if(now()>until)break;
   let text=dataScript(url);
   if(text===null)try{const r=await fetchImpl(url,{credentials:'omit',cache:'force-cache'});text=r.status===200?await r.text():'';}catch{text='';}
   const id=docIdFromScript(text);
   if(id)return id;
  }
  return null;
 }
 /** The query id the Replies tab uses right now, from Threads' own scripts; null when they do not show it. */
 async function pageDocId(me){
  if(seen&&now()-seen.at<DOC_TTL)return seen.docId;
  const until=now()+DOC_BUDGET;
  let here=[];try{here=[...doc.querySelectorAll('script[src]')].map(s=>s.src).concat((perf?.getEntriesByType?.('resource')??[]).map(e=>e.name));}catch{}
  let id=await firstDocId(bundleUrls(here),until);
  if(!id&&now()<=until)try{
   const r=await fetchImpl(`/@${encodeURIComponent(me)}/replies`,{credentials:'include',cache:'no-store'});
   if(r.status===200)id=await firstDocId(htmlScriptUrls(await r.text()),until);
  }catch{}
  seen={docId:id,at:now()};
  return id;
 }
 async function slot(){
  for(;;){
   const s=await runtime.profileSlot();
   if(s?.ok)return true;
   if(s?.reason==='gap'&&Number.isFinite(s.retryAt)){await sleep(Math.max(0,s.retryAt-now()));continue;}
   return false;
  }
 }
 const outcome=kind=>Promise.resolve(runtime.profileOutcome?.(kind)).catch(()=>{});
 const fail=(code,stats={})=>({ok:false,code,stats});
 /** Reads one account's replies: {ok:true, rows, stats} or {ok:false, code, stats}. Never throws, never retries. */
 return async function read(username,flags=null){
  const started=now(),me=String(username??'').toLowerCase();
  try{
   const text=scripts(),tokens=pageTokens(text,doc.cookie);
   if(!tokens.loggedIn)return fail('SIGNED_OUT');
   if(!tokens.ready)return fail('TOKENS');
   const relay=pageRelay(text);
   if(!Object.keys(relay).length)return fail('TOKENS');
   if(!await slot())return fail('BLOCKED');
   const card=hovercardRequest(me,tokens);
   let res;try{res=await fetchImpl(card.url,card.init);}catch{return fail('NETWORK');}
   if(res.status!==200){await outcome(statusKind(res.status));return fail(refused(res.status)?'REFUSED':`HTTP_${res.status}`);}
   let user;try{user=parseHovercard(await res.text(),me);}catch{await outcome('parse');return fail('PARSE');}
   if(!user)return fail('NO_USER');
   const query=queryOf(flags,await pageDocId(me)),docSource=query.source;
   const req=repliesRequest(user.pk,tokens,{...query,relay});
   let page;try{page=await fetchImpl(req.url,req.init);}catch{return fail('NETWORK',{docSource});}
   if(page.status!==200){await outcome(statusKind(page.status));return fail(refused(page.status)?'REFUSED':`HTTP_${page.status}`,{docSource});}
   const parsed=parseReplies(await page.text(),me);
   if(!parsed.ok){
    // A query id the page itself gave that Threads no longer takes: looked for again at the next press.
    if(parsed.code==='QUERY'&&docSource==='page')seen=null;
    await outcome('parse');return fail(parsed.code,{docSource});
   }
   await outcome('ok');
   let rows=parsed.rows;
   const hidden=rows.filter(r=>r.parentUrl===null).length,stats={own:parsed.own,selfThread:parsed.selfThread,hidden,filled:0,gone:0,errors:parsed.errors,docSource,readMs:now()-started};
   // More hidden parents than the fill-in allows (a user who blocked the accounts this one talks to): not sent; the
   // site's own fetch covers the account (plan 10-30 處理順序 3).
   if(hidden>PARENT_FILL_MAX)return fail('HIDDEN',stats);
   for(const code of hiddenCodes(rows)){
    let html;
    try{const r=await fetchImpl(`/@${me}/post/${code}`,{credentials:'omit',cache:'no-store'});if(r.status!==200)continue;html=await r.text();}catch{continue;}
    const p=parentFromPostPage(html,code,me);
    if(p.found&&p.parent){rows=withParent(rows,code,p.parent);stats.filled++;}
    else if(p.found)stats.gone++;
   }
   stats.ms=now()-started;
   const body=submission(rows);
   if(!body)return fail('TOO_FEW',stats);
   return {ok:true,rows:body.rows,stats};
  }catch{return fail('FAILED');}
 };
}
