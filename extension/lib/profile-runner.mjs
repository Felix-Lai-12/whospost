// The 帳號背景 queue in the content script (EXTENSION-SPEC §4.4): the engine says which authors are on screen right now
// (want), this looks each up at most once a week, one request at a time, through the background script's pacing and
// stop rule, and tells the engine when something changed. Only names still on screen are looked up (rule 1); the
// results stay in this browser (rule 2). Every per-author answer is one of: queued, loading, ok (data), none (Threads
// has no such account), failed (will retry later); the global reasons for not reading (switched off, remote switch off,
// paused, signed out, hourly cap) are kept apart from them.
// 追蹤中: the count is read with the rest; the first 50 of the list only when the user opens that author's popover
// (wantFollowing), since it takes up to three more requests. Its own answer: loading, ok, private, failed.
import {pageTokens,hovercardRequest,aboutRequest,countsRequest,followingRequest,parseHovercard,parseAbout,parseCounts,parseFollowingPage,mergeFollowing,followingSummary,FOLLOWING_SAMPLE,statusKind,cacheGet,LookupError,validUsername} from './profile.mjs';
export const RETRY_FAILED_MS=10*60000;
export function createProfileRunner({runtime,doc=document,fetchImpl=(...a)=>globalThis.fetch(...a),now=Date.now,onUpdate=()=>{},sleep=ms=>new Promise(r=>setTimeout(r,ms)),setTimer=(fn,ms)=>setTimeout(fn,ms),clearTimer=id=>clearTimeout(id)}){
 const states=new Map(),follow=new Map(),followWanted=new Set();let cache={},visible=new Set(),running=false,blocked=null,blockedUntil=null,tokens=null,tokensPath=null,stopped=false,wake=null;
 const changed=()=>{try{onUpdate();}catch{}};
 const set=(u,s)=>{states.set(u,{...s,at:now()});changed();};
 function readTokens(){
  const path=doc.location?.pathname??'';
  if(!tokens||tokensPath!==path){tokens=pageTokens([...doc.querySelectorAll('script:not([src])')].map(s=>s.textContent).join('\n'),doc.cookie);tokensPath=path;}
  return tokens;
 }
 const block=(reason,until=null)=>{if(blocked!==reason||blockedUntil!==until){blocked=reason;blockedUntil=until;changed();}};
 // Every outcome goes to the stop rule; the answer says at once when this one tripped it, so the pause shows even when
 // no other author is waiting to ask for a slot.
 const outcome=async kind=>{const r=await runtime.profileOutcome(kind);if(r?.paused)block('paused',Number.isFinite(r.retryAt)?r.retryAt:null);};
 // One request: a slot from the background script first (pacing, hourly cap, switches, stop rule), then the fetch.
 async function request(req){
  for(;;){
   const s=await runtime.profileSlot();
   if(s?.ok)break;
   if(s?.reason==='gap'&&Number.isFinite(s.retryAt)){await sleep(Math.max(0,s.retryAt-now()));continue;}
   throw Object.assign(new LookupError('BLOCKED'),{reason:s?.reason??'off',retryAt:s?.retryAt??null});
  }
  let res;
  try{res=await fetchImpl(req.url,req.init);}catch{throw new LookupError('NETWORK');}
  const kind=statusKind(res.status);
  if(kind!=='ok'){await outcome(kind);throw new LookupError(kind==='refused'?'REFUSED':`HTTP_${res.status}`);}
  return res.text();
 }
 async function lookup(username){
  const t=readTokens();
  if(!t.loggedIn){block('signedOut');return false;}
  // Signed in but the tokens are not where they were: the page changed, which counts toward the stop rule.
  if(!t.ready){await outcome('parse');set(username,{status:'failed',code:'TOKENS'});return true;}
  set(username,{status:'loading'});
  try{
   const card=parseHovercard(await request(hovercardRequest(username,t)),username);
   if(!card){await outcome('ok');set(username,{status:'none'});return true;}
   const about=parseAbout(await request(aboutRequest(card.pk,t)));
   // The counts are their own request: when it fails or no longer reads, 追蹤 is left unknown (never 0) and the rest is
   // kept; the lookup as a whole worked, so the stop rule sees a success.
   let counts={followers:null,following:null};
   try{counts=parseCounts(await request(countsRequest(card.pk,t)));}catch(e){if(e.code==='BLOCKED')throw e;}
   const data={pk:card.pk,followers:card.followers??counts.followers,following:counts.following,isPrivate:card.isPrivate,...about};
   await outcome('ok');
   cache={...cache,[username]:{at:now(),data}};
   await runtime.profileSave(username,data);
   set(username,{status:'ok',data});
  }catch(e){
   if(e.code==='BLOCKED'){states.delete(username);block(e.reason,e.retryAt);changed();return false;}
   if(e.code==='PARSE')await outcome('parse');
   set(username,{status:'failed',code:e.code??'FAILED'});
  }
  return true;
 }
 const dataOf=u=>cacheGet(cache,u,now())??(states.get(u)?.status==='ok'?states.get(u).data:null);
 const setFollow=(u,s)=>{follow.set(u,{...s,at:now()});changed();};
 // The first 50 of one author's 「追蹤中」 list, page by page through the same slots; usernames only are kept.
 async function lookupFollowing(username){
  const t=readTokens(),data=dataOf(username);
  if(!t.loggedIn){block('signedOut');return false;}
  if(!data?.pk)return true;
  if(data.isPrivate){setFollow(username,{status:'private'});return true;}
  setFollow(username,{status:'loading'});
  try{
   let sample={users:[]},after=null;
   for(let page=0;page<4;page++){
    const got=parseFollowingPage(await request(followingRequest(data.pk,t,{after,first:Math.min(20,FOLLOWING_SAMPLE-sample.users.length)})));
    sample=mergeFollowing(sample,got);after=sample.next;
    if(sample.done)break;
   }
   await outcome('ok');
   const next={...data,followingSample:{...followingSummary(sample.users,!sample.next),at:now()}};
   cache={...cache,[username]:{at:cache[username]?.at??now(),data:next}};
   if(states.get(username)?.status==='ok')states.set(username,{...states.get(username),data:next});
   await runtime.profileSave(username,next);
   setFollow(username,{status:'ok'});
  }catch(e){
   if(e.code==='BLOCKED'){follow.delete(username);block(e.reason,e.retryAt);changed();return false;}
   if(e.code==='PARSE')await outcome('parse');
   setFollow(username,{status:'failed',code:e.code??'FAILED'});
  }
  return true;
 }
 const followDue=u=>{const d=dataOf(u);if(!d?.pk||d.followingSample)return false;const s=follow.get(u);if(!s)return true;return s.status==='failed'&&now()-s.at>=RETRY_FAILED_MS;};
 const due=u=>{const s=states.get(u);if(cacheGet(cache,u,now()))return false;if(!s)return true;return s.status==='failed'&&now()-s.at>=RETRY_FAILED_MS;};
 async function pump(){
  if(running||stopped)return;running=true;
  try{
   for(;;){
    if(blocked){if(Number.isFinite(blockedUntil)&&now()>=blockedUntil)block(null);else break;}
    const next=[...visible].find(due);
    if(next){if(!await lookup(next))break;continue;}
    const more=[...followWanted].find(followDue);
    if(!more)break;
    if(!await lookupFollowing(more))break;
   }
  }finally{running=false;}
  // A block with an end (hourly cap, the stop rule's pause) wakes the queue once it is over.
  if(blocked&&Number.isFinite(blockedUntil)&&!stopped&&wake===null)wake=setTimer(()=>{wake=null;if(blocked&&now()>=blockedUntil){block(null);pump();}},Math.max(1000,blockedUntil-now()+50));
 }
 return {
  /** The authors on screen now, in page order. Only these are looked up. */
  want(usernames){visible=new Set(usernames.map(u=>String(u).toLowerCase()).filter(validUsername));for(const u of visible){if(cacheGet(cache,u,now())&&states.get(u)?.status!=='ok')states.set(u,{status:'ok',data:cacheGet(cache,u,now()),at:now()});}pump();},
  /** {status, data} for one author: the cache first, then this page's answer, else queued. */
  /** The user opened this author's popover: read the first 50 of its 「追蹤中」 list once its other data is in. */
  wantFollowing(username){const u=String(username).toLowerCase();if(!validUsername(u))return;followWanted.add(u);pump();},
  /** The 追蹤名單 part for one author: ok (in data.followingSample), private, loading, failed, or null (not asked). */
  following(username){const u=String(username).toLowerCase(),d=dataOf(u);if(d?.followingSample)return {status:'ok'};if(d?.isPrivate)return {status:'private'};const s=follow.get(u);if(s)return {status:s.status};return followWanted.has(u)?{status:blocked??'queued'}:null;},
  get(username){const u=String(username).toLowerCase(),c=cacheGet(cache,u,now());if(c)return {status:'ok',data:c};const s=states.get(u);if(s)return {status:s.status==='failed'?'failed':s.status,data:s.data??null};return {status:blocked??'queued',data:null};},
  /** Why nothing is being read right now, or null. */
  get blocked(){return blocked;},
  get retryAt(){return blockedUntil;},
  setCache(next){cache=next&&typeof next==='object'?next:{};changed();},
  /** The switches changed (popup, remote, stop rule): forget why it was blocked and try again. */
  resume(){block(null);pump();},
  /** Signed-out pages and a new page path re-read the tokens. */
  resetPage(){tokens=null;},
  stop(){stopped=true;if(wake!==null)clearTimer(wake);wake=null;}
 };
}
