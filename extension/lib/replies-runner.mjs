// The replies read in the content script (0.2.0, lib/replies.mjs): one account per 「AI 打詐」 press, started at the
// press and sent to the site once the scan id is known (plan-extension-replies 10-30 處理順序 2). Same origin, the
// user's own session: the hover card for the user id (as 帳號背景 does), then one page of the Replies tab; a parent
// Threads hides from this user is read again logged out (credentials omitted), at most PARENT_FILL_MAX of them.
// Pacing, the hourly cap and the stop rule are 帳號背景's (background profileSlot / profileOutcome): one slot per
// account, shared by the two requests. Nothing here draws or blocks; the engine only awaits the promise.
import {pageTokens,hovercardRequest,parseHovercard,statusKind} from './profile.mjs';
import {pageRelay,queryOf,repliesRequest,parseReplies,hiddenCodes,parentFromPostPage,withParent,submission,refused,PARENT_FILL_MAX} from './replies.mjs';
export function createRepliesReader({runtime,doc=document,fetchImpl=(...a)=>globalThis.fetch(...a),now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms))}){
 const scripts=()=>[...doc.querySelectorAll('script:not([src])')].map(s=>s.textContent).join('\n');
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
   const req=repliesRequest(user.pk,tokens,{...queryOf(flags),relay});
   let page;try{page=await fetchImpl(req.url,req.init);}catch{return fail('NETWORK');}
   if(page.status!==200){await outcome(statusKind(page.status));return fail(refused(page.status)?'REFUSED':`HTTP_${page.status}`);}
   const parsed=parseReplies(await page.text(),me);
   if(!parsed.ok){await outcome('parse');return fail(parsed.code);}
   await outcome('ok');
   let rows=parsed.rows;
   const hidden=rows.filter(r=>r.parentUrl===null).length,stats={own:parsed.own,selfThread:parsed.selfThread,hidden,filled:0,gone:0,errors:parsed.errors,readMs:now()-started};
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
