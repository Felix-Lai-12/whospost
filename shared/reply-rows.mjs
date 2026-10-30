// Replies the browser extension reads with the user's own Threads session and sends back (plan-extension-replies
// 2026-10-29, P0 shadow mode). The rows are the caller's to write, so before anything else they must agree with
// themselves: a Threads post code is the post's id in base 64, and that id carries the second it was posted (Instagram's
// id layout, checked 2026-10-29 on three replies: the code's time matched the posted time to the second). A made-up
// time, or an id that is not its code, fails here for free; whether the post exists, and says what the row says, is
// the server's spot check (server/reply-check.mjs).
const ALPHABET='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const EPOCH_MS=1314220021721;
const CODE=/^[A-Za-z0-9_-]{6,20}$/,USERNAME=/^[a-z0-9_.]{1,30}$/;
const POST_URL=/^https:\/\/www\.threads\.com\/@([a-z0-9_.]{1,30})\/post\/([A-Za-z0-9_-]{6,20})$/;
export const REPLY_KEYS=Object.freeze(['id','text','postedAt','url','parentUrl','parentAuthor','isQuote','isRepost']);
// At least six: every reply signal needs six rows to be judged (shared/signals.mjs). At most 30: the page size the
// extension asks for (25) with room to spare.
export const MIN_REPLIES=6,MAX_REPLIES=30,MAX_TEXT=1000;
// How far a row's time may sit from its code's time, and how far into the future (the user's clock is not ours).
const TIME_SLACK_MS=2000,FUTURE_SLACK_MS=60000;
/** The post id a code stands for, as a decimal string; null for anything that is not a code. */
export function codeToId(code){
 if(!CODE.test(String(code??'')))return null;
 let n=0n;for(const ch of code)n=n*64n+BigInt(ALPHABET.indexOf(ch));
 return n.toString();
}
/** When the post with this code was made, in ms since the epoch; null for anything that is not a code. */
export function codeTime(code){const id=codeToId(code);return id===null?null:Number(BigInt(id)>>23n)+EPOCH_MS;}
/** The author and code of a canonical post link (https://www.threads.com/@name/post/CODE); null otherwise. */
export function postLink(url){const m=String(url??'').match(POST_URL);return m?{author:m[1],code:m[2]}:null;}
const fail=(code,index=null)=>({ok:false,code,index});
/** Checks a submission against itself: {ok:true, rows, dropped} with the rows kept (each owned by `username`; a row
 *  whose time is off its code is dropped and listed in `dropped` as {index, code}), or {ok:false, code, index} naming
 *  the first problem. `now` bounds how new a row may be. */
export function checkReplyRows(rows,username,now){
 const me=String(username??'').toLowerCase();
 if(!USERNAME.test(me))return fail('INVALID_TARGET');
 if(!Array.isArray(rows))return fail('INVALID_ROWS');
 if(rows.length<MIN_REPLIES)return fail('TOO_FEW_REPLIES');
 if(rows.length>MAX_REPLIES)return fail('TOO_MANY_REPLIES');
 const seen=new Set(),dropped=[];
 for(const [i,r] of rows.entries()){
  if(!r||typeof r!=='object'||Array.isArray(r)||Object.keys(r).length!==REPLY_KEYS.length||!REPLY_KEYS.every(k=>Object.hasOwn(r,k)))return fail('INVALID_ROW',i);
  if(typeof r.text!=='string'||r.text.length>MAX_TEXT||typeof r.isQuote!=='boolean'||typeof r.isRepost!=='boolean')return fail('INVALID_ROW',i);
  const own=postLink(r.url);
  if(!own||own.author!==me)return fail('NOT_TARGET_AUTHOR',i);
  if(r.id!==codeToId(own.code))return fail('ID_NOT_CODE',i);
  if(seen.has(r.id))return fail('DUPLICATE_ID',i);seen.add(r.id);
  const at=typeof r.postedAt==='string'?Date.parse(r.postedAt):NaN,made=codeTime(own.code);
  if(!Number.isFinite(at))return fail('TIME_NOT_CODE',i);
  // A time off its code is dropped, not refused (Felix 10-30): Apify's own rows for a real account had 1 in 15 off by
  // 38 s, so a whole page cannot be refused for one such row; a forged time still cannot pass as evidence.
  if(Math.abs(at-made)>TIME_SLACK_MS){dropped.push({index:i,code:'TIME_NOT_CODE'});continue;}
  if(at>now+FUTURE_SLACK_MS)return fail('FUTURE_TIME',i);
  // A reply whose parent Threads would not show this user comes without one (probe: hkj315); both or neither.
  if((r.parentUrl===null)!==(r.parentAuthor===null))return fail('INVALID_PARENT',i);
  if(r.parentUrl!==null){
   const parent=postLink(r.parentUrl);
   if(!parent||parent.author!==r.parentAuthor||parent.code===own.code)return fail('INVALID_PARENT',i);
   if(codeTime(parent.code)>made+TIME_SLACK_MS)return fail('PARENT_AFTER_REPLY',i);
  }
 }
 const kept=dropped.length?rows.filter((_,i)=>!dropped.some(d=>d.index===i)):rows;
 if(kept.length<MIN_REPLIES)return fail('TOO_FEW_REPLIES');
 return {ok:true,rows:kept,dropped};
}
/** The rows as scan evidence, shaped like the Apify replies (server/providers/normalize.mjs). */
export const asAuthoredReplies=(rows,username)=>rows.map(r=>({id:r.id,author:String(username).toLowerCase(),kind:'authored_reply',text:r.text,postedAt:new Date(Date.parse(r.postedAt)).toISOString(),url:r.url,parentUrl:r.parentUrl,parentAuthor:r.parentAuthor,isQuote:r.isQuote,isRepost:r.isRepost,isReply:true,source:'whospost-extension'}));
