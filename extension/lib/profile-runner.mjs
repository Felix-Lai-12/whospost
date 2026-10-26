// The 帳號背景 queue in the content script (EXTENSION-SPEC §4.4): the engine says which authors are on screen right now
// (want), this looks each up at most once a week, one request at a time, through the background script's pacing and
// stop rule, and tells the engine when something changed. Only names still on screen are looked up (rule 1); the
// results stay in this browser (rule 2). Every per-author answer is one of: queued, loading, ok (data), none (Threads
// has no such account), failed (will retry later); the global reasons for not reading (switched off, remote switch off,
// paused, signed out, hourly cap) are kept apart from them.
import {pageTokens,hovercardRequest,aboutRequest,parseHovercard,parseAbout,statusKind,cacheGet,LookupError,validUsername} from './profile.mjs';
export const RETRY_FAILED_MS=10*60000;
export function createProfileRunner({runtime,doc=document,fetchImpl=(...a)=>globalThis.fetch(...a),now=Date.now,onUpdate=()=>{},sleep=ms=>new Promise(r=>setTimeout(r,ms)),setTimer=(fn,ms)=>setTimeout(fn,ms),clearTimer=id=>clearTimeout(id)}){
 const states=new Map();let cache={},visible=new Set(),running=false,blocked=null,blockedUntil=null,tokens=null,tokensPath=null,stopped=false,wake=null;
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
 // One request: a slot from the background script first (pacing, hourly cap, switches, stop rule), then the fetch. The
 // slot is per account (Felix 10-26: 每 2 秒一個帳號、每小時 300 個): the hover card takes it, and the 「關於此個人檔案」
 // read that follows for the same account goes at once.
 async function request(req,{paced=true}={}){
  for(;paced;){
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
   const about=parseAbout(await request(aboutRequest(card.pk,t),{paced:false}));
   // Only what is shown is kept: the hover card's follower count and privacy flag stay unread (Felix 10-24).
   const data={...about};
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
 const due=u=>{const s=states.get(u);if(cacheGet(cache,u,now()))return false;if(!s)return true;return s.status==='failed'&&now()-s.at>=RETRY_FAILED_MS;};
 async function pump(){
  if(running||stopped)return;running=true;
  try{
   for(;;){
    if(blocked){if(Number.isFinite(blockedUntil)&&now()>=blockedUntil)block(null);else break;}
    const next=[...visible].find(due);
    if(!next)break;
    if(!await lookup(next))break;
   }
  }finally{running=false;}
  // A block with an end (hourly cap, the stop rule's pause) wakes the queue once it is over.
  if(blocked&&Number.isFinite(blockedUntil)&&!stopped&&wake===null)wake=setTimer(()=>{wake=null;if(blocked&&now()>=blockedUntil){block(null);pump();}},Math.max(1000,blockedUntil-now()+50));
 }
 return {
  /** The authors on screen now, in page order. Only these are looked up. */
  want(usernames){visible=new Set(usernames.map(u=>String(u).toLowerCase()).filter(validUsername));for(const u of visible){if(cacheGet(cache,u,now())&&states.get(u)?.status!=='ok')states.set(u,{status:'ok',data:cacheGet(cache,u,now()),at:now()});}pump();},
  /** {status, data} for one author: the cache first, then this page's answer, else queued. */
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
