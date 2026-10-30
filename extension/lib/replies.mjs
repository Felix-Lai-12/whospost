// 留言改由擴充套件抓取 (plan-extension-replies-20261029, extension 0.2.0, P1 shadow mode): after 「AI 打詐」 the content
// script reads the account's latest replies with the user's own Threads session — the Replies tab's own query, one
// page of 25, no paging (Felix 10-30) — and sends them to the site as rows in the shape of shared/reply-rows.mjs. In
// shadow mode the site only compares them with the Apify result (POST /api/scans/:id/replies); nothing here changes
// what the user sees. Pure: the request, the answer's rows, the logged-out parent fill-in, and what is sent.
// Measured on Dia 2026-10-29/30 (100_Todo/specs/011-whospost/probe-extension-replies-20261029.md, rounds 2–5):
// a page of 25 takes 3.7–13.6 s; 40 and up fails outright (HTTP 572) for heavy accounts, hence no larger page; the
// query id changed three times in two days, so the site hands out the current one (/api/health extension.repliesQuery)
// and the answer can carry `errors` next to usable `data`.
import {form,IG_APP_ID} from './profile.mjs';
export const REPLIES_NAME='BarcelonaProfileRepliesTabRefetchableDirectQuery';
export const DEFAULT_DOC_ID='39901003386179772',PAGE=25,MAX_ROWS=30,MIN_ROWS=6;
// A reply whose parent Threads hides from this user (a block between them, probe round 3) is read again logged out,
// one page each (≈1.3 s, 750 KB); more hidden parents than this and the page is not sent at all: the Apify fetch
// the site runs anyway covers the account (plan 10-30 處理順序 3).
export const PARENT_FILL_MAX=6;
export const REPLIES_PATH=scanId=>`/api/scans/${scanId}/replies`;
const DOC=/^\d{10,25}$/,CODE=/^[A-Za-z0-9_-]{6,20}$/;
const lower=v=>String(v??'').replace(/^@/,'').toLowerCase();
const iso=sec=>Number.isFinite(Number(sec))?new Date(Number(sec)*1000).toISOString():null;
const json=text=>{try{return JSON.parse(String(text).replace(/^for \(;;\);/,''));}catch{return null;}};
/** Every value stored under `key` anywhere in a JSON tree. */
export function findAll(tree,key,out=[]){
 if(Array.isArray(tree))for(const v of tree)findAll(v,key,out);
 else if(tree&&typeof tree==='object')for(const [k,v] of Object.entries(tree)){if(k===key)out.push(v);findAll(v,key,out);}
 return out;
}
/** The page's own relay provider flags, read from its inline scripts; the Replies query answers nothing without them
 *  (54 on 2026-10-30; which ones Threads wants changes with the page, so they are read, never listed here). */
export function pageRelay(scriptsText){
 const out={};
 for(const m of String(scriptsText??'').matchAll(/"(__relay_internal__pv__[A-Za-z0-9_]+relayprovider)":(true|false)/g))out[m[1]]=m[2]==='true';
 return out;
}
/** The query the site hands out ({docId, first} under /api/health extension.repliesQuery, lib/flags.mjs), or the defaults. */
export function queryOf(flags){
 const q=flags?.repliesQuery;
 const docId=DOC.test(String(q?.docId??''))?String(q.docId):DEFAULT_DOC_ID;
 const first=Number.isInteger(q?.first)&&q.first>=MIN_ROWS&&q.first<=MAX_ROWS?q.first:PAGE;
 return {docId,first};
}
/** The Replies-tab request for a user id: same origin, the user's session, the page's tokens and relay flags. */
export function repliesRequest(userId,tokens,{docId=DEFAULT_DOC_ID,first=PAGE,relay={}}={}){
 const variables={after:null,allow_page_info_for_lox_user:false,before:null,first,last:null,userID:String(userId),...relay};
 return {url:'/graphql/query',init:{method:'POST',credentials:'include',headers:{'Content-Type':'application/x-www-form-urlencoded','X-FB-LSD':tokens.lsd,'X-CSRFToken':tokens.csrf,'X-IG-App-ID':IG_APP_ID,'X-FB-Friendly-Name':REPLIES_NAME},
  body:form(tokens,{fb_api_caller_class:'RelayModern',fb_api_req_friendly_name:REPLIES_NAME,server_timestamps:'true',doc_id:docId,variables:JSON.stringify(variables)})}};
}
/** One post node as {id, author, code, url, text, postedAt, isQuote, isRepost, replyTo, isReply}; null without author or
 *  code. isReply: Threads says so (is_reply), names the author replied to, or says the parent cannot be shown. */
export function record(post){
 const author=lower(post?.user?.username),code=post?.code;
 if(!author||!CODE.test(String(code)))return null;
 const info=post.text_post_app_info??{},share=info.share_info??{};
 const replyTo=lower(info.reply_to_author?.username)||null;
 return {id:String(post.pk??post.id??''),author,code,url:`https://www.threads.com/@${author}/post/${code}`,text:String(post.caption?.text??''),postedAt:iso(post.taken_at),isQuote:Boolean(share?.quoted_post),isRepost:Boolean(share?.reposted_post),replyTo,isReply:info.is_reply===true||replyTo!==null||(info.parent_post_unavailable_reason!=null)};
}
const row=(r,parent)=>({id:r.id,text:r.text,postedAt:r.postedAt,url:r.url,parentUrl:parent?.url??null,parentAuthor:parent?.author??null,isQuote:r.isQuote,isRepost:r.isRepost});
/** The Replies-tab answer as rows for the site: the account's own replies in other people's threads, in page order,
 *  each with its parent when the answer shows one (the item before it in the same thread by the author it replies to),
 *  or parentUrl/parentAuthor null when Threads hides the parent from this user (parent_post_unavailable_reason, probe
 *  round 2) — those are filled in logged out (parentFromPostPage) or left null. Replies in the account's own threads
 *  are left out (the site's standard-20 scope). `errors` beside `data` is not a failure (round 4: Threads answers
 *  both when one post's share_info cannot be resolved). {ok:false, code} when the answer carries no threads at all. */
export function parseReplies(text,username){
 const me=lower(username),body=json(text);
 if(!body||typeof body!=='object')return {ok:false,code:'PARSE'};
 const data=body.data;
 if(!data||typeof data!=='object')return {ok:false,code:Array.isArray(body.errors)&&body.errors.length?'QUERY':'PARSE'};
 const threads=findAll(data,'thread_items').filter(Array.isArray);
 if(!threads.length&&!findAll(data,'mediaData').some(m=>m&&typeof m==='object'))return {ok:false,code:'PARSE'};
 const seen=new Set(),rows=[];let own=0,selfThread=0,hidden=0;
 for(const items of threads){
  const posts=items.map(it=>record(it?.post));
  posts.forEach((p,i)=>{
   // The account's own opening posts (a thread it started that its reply continues) are not replies: skipped.
   if(!p||p.author!==me||!p.id||!p.postedAt||!p.isReply||seen.has(p.id))return;
   seen.add(p.id);own++;
   if(p.replyTo===me){selfThread++;return;}
   let parent=null;
   if(p.replyTo)for(let j=i-1;j>=0;j--){const q=posts[j];if(q&&q.author===p.replyTo&&q.id&&q.postedAt){parent=q;break;}}
   if(!parent)hidden++;
   rows.push(row(p,parent));
  });
 }
 return {ok:true,rows:rows.slice(0,MAX_ROWS),own,selfThread,hidden:Math.min(hidden,rows.slice(0,MAX_ROWS).filter(r=>r.parentUrl===null).length),errors:Array.isArray(body.errors)&&body.errors.length>0};
}
/** The codes of the rows still without a parent, in page order, up to `max`. */
export const hiddenCodes=(rows,max=PARENT_FILL_MAX)=>rows.filter(r=>r.parentUrl===null).map(r=>r.url.split('/post/')[1]).slice(0,max);
/** The logged-out post page of one reply (probe round 3: fetched without cookies it shows what everyone sees):
 *  {found:true, parent:{url, author}} when the page names the author replied to and carries that post in the thread,
 *  {found:true, parent:null} when the page has the reply but no parent for anyone (deleted, or the account is gone),
 *  {found:false} when the page does not carry the reply at all (a login wall, a changed page). */
export function parentFromPostPage(html,code,username){
 const me=lower(username);
 for(const m of String(html??'').matchAll(/<script type="application\/json"[^>]*data-sjs[^>]*>([\s\S]*?)<\/script>/g)){
  if(!m[1].includes(String(code)))continue;
  const blob=json(m[1]);if(!blob)continue;
  const reply=findAll(blob,'media').map(record).find(r=>r&&r.code===code&&r.author===me);
  if(!reply)continue;
  if(!reply.replyTo||reply.replyTo===me)return {found:true,parent:null};
  const at=Date.parse(reply.postedAt);
  const candidates=findAll(blob,'containing_thread').flatMap(t=>t?.posts?.edges??[]).map(e=>record(e?.node)).filter(r=>r&&r.author===reply.replyTo&&r.code!==code&&r.id&&r.postedAt&&(!Number.isFinite(at)||Date.parse(r.postedAt)<=at));
  if(!candidates.length)return {found:true,parent:null};
  const parent=candidates.reduce((a,b)=>Date.parse(b.postedAt)>Date.parse(a.postedAt)?b:a);
  return {found:true,parent:{url:parent.url,author:parent.author}};
 }
 return {found:false,parent:null};
}
/** The rows with a found parent written in. */
export const withParent=(rows,code,parent)=>rows.map(r=>r.url.endsWith(`/post/${code}`)&&parent?{...r,parentUrl:parent.url,parentAuthor:parent.author}:r);
/** What goes to the site: {rows} only, at most MAX_ROWS; null when there are too few rows to be judged. */
export const submission=rows=>Array.isArray(rows)&&rows.length>=MIN_ROWS?{rows:rows.slice(0,MAX_ROWS)}:null;
/** What a fetch status of the Threads requests means for the stop rule shared with 帳號背景 (lib/profile.mjs). */
export const refused=status=>status===429||status===403;
/** The daily count a read outcome adds (lib/report.mjs): sent, refused by Threads, or failed. */
export const outcomeCounter=code=>code==='SENT'?'repliesSent':code==='REFUSED'?'repliesRefused':'repliesFailed';
// The one-time notice shown before the first read (plan 使用者帳號 §): what is read, with whose session, where it goes.
export const NOTICE='AI 打詐會用你的 Threads 登入狀態，讀取這個帳號最近 25 則公開回覆並送回 Whospost 比對。可在擴充套件視窗關閉。';
