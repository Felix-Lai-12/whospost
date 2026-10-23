// Thread observation (§4.1): only the replies already loaded on this page, counted on this machine, never uploaded.
// Two rules: how many replies one account left in this thread, and how many different accounts posted the same text.
// Text is normalised with the site's own norm/bare/common from shared/signals.mjs, so the two agree and change together.
import {norm,bare,common} from './signals.mjs';
export const SHORT_CHARS=4;
/** The comparison key for a reply's text, or null when the text is too short (≤ SHORT_CHARS once punctuation and
 *  spaces are gone) or one of the greeting words the site ignores too. */
export function contentKey(text){
 const t=norm(text);
 if(!t||bare(t).length<=SHORT_CHARS||common(t))return null;
 return t;
}
/** The registry of replies seen on the current page. `add` is idempotent per (username, replyKey): a React node
 *  that is rendered twice, or recycled and read again, counts once. */
export function createThread(){
 let byAuthor=new Map(),byContent=new Map();
 const bump=(k,u,d)=>{let m=byContent.get(k);if(!m){m=new Map();byContent.set(k,m);}const n=(m.get(u)||0)+d;if(n>0)m.set(u,n);else m.delete(u);if(!m.size)byContent.delete(k);};
 return {
  add({username,replyKey,text}){
   const u=String(username).toLowerCase(),k=String(replyKey);
   let replies=byAuthor.get(u);if(!replies){replies=new Map();byAuthor.set(u,replies);}
   const next=contentKey(text),prev=replies.has(k)?replies.get(k):undefined;
   if(replies.has(k)&&prev===next)return false;
   if(replies.has(k)&&prev)bump(prev,u,-1);
   replies.set(k,next);if(next)bump(next,u,1);
   return true;
  },
  reset(){byAuthor=new Map();byContent=new Map();},
  /** How many replies this account left here, and the largest number of different accounts sharing one of its texts. */
  observe(username){
   const u=String(username).toLowerCase(),replies=byAuthor.get(u);
   if(!replies)return {replies:0,sameContent:0};
   let sameContent=0;for(const k of new Set([...replies.values()].filter(Boolean)))sameContent=Math.max(sameContent,byContent.get(k)?.size??0);
   return {replies:replies.size,sameContent};
  },
  get authors(){return byAuthor.size;}
 };
}
/** Which of these replies (page order, each {username}) is its account's first one here. The thread rules count
 *  every reply of an account, but the page marks the account once, on that first reply (Felix 2026-10-23: 「只要出現
 *  在第一次留言即可」); later replies of the same account draw nothing for the thread. Recomputed on every scan from
 *  the current page order, so a recycled or re-sorted node is re-evaluated. */
export function firstReplies(items){
 const seen=new Set();
 return items.map(it=>{const u=String(it?.username??'').toLowerCase();if(!u||seen.has(u))return false;seen.add(u);return true;});
}
/** The verdict for a reply the thread rules do not mark: nothing to draw, nothing counted. */
export const NO_THREAD=Object.freeze({level:'none',reasons:[],replies:0,sameContent:0});
/** What the thread rules say for one account under these thresholds (settings.thread): the level to draw at and
 *  the reasons, for the bar text. sameContent counts the account itself, so 3 means two other accounts. */
export function threadVerdict({replies=0,sameContent=0},{enabled=true,barAt=5,fadeAt=10,sameContentAt=3}={}){
 if(!enabled)return {level:'none',reasons:[],replies,sameContent};
 const reasons=[];
 if(replies>=barAt)reasons.push({rule:'replies',n:replies});
 if(sameContent>=sameContentAt)reasons.push({rule:'sameContent',n:sameContent});
 const level=replies>=fadeAt?'fade':reasons.length?'bar':'none';
 return {level,reasons,replies,sameContent};
}
