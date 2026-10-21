// Pure parsers for the JSON Threads embeds in its public pages (<script type="application/json" data-sjs>) and
// for the GraphQL bodies the page fetches when scrolled. No network, no browser: the browser provider feeds
// these the page HTML and captured responses. Field names were checked logged-out from Cloudflare's network
// on 2026-10-21 (100_Todo/specs/011-whospost/probe-browser-rendering-20261021.md): a post carries pk, code,
// user.username, caption.text, taken_at, text_post_app_info.direct_reply_count and share_info (reposted_post,
// quoted_post); the profile and Replies tabs list threads under mediaData.edges[].node.thread_items[]; a post
// page lists replies under direct_replies.edges[].node.posts.edges[].
const lower=v=>String(v??'').replace(/^@/,'').toLowerCase();
const iso=sec=>Number.isFinite(sec)?new Date(sec*1000).toISOString():null;
/** Every value stored under `key` anywhere in a JSON tree. */
export function findAll(tree,key,out=[]){
 if(Array.isArray(tree))for(const v of tree)findAll(v,key,out);
 else if(tree&&typeof tree==='object')for(const [k,v] of Object.entries(tree)){if(k===key)out.push(v);findAll(v,key,out);}
 return out;
}
/** The embedded JSON blobs that carry thread data, parsed. Blobs that fail to parse are skipped. */
export function blobsFromHtml(html){
 const out=[];
 for(const m of String(html).matchAll(/<script type="application\/json"[^>]*data-sjs[^>]*>([\s\S]*?)<\/script>/g)){
  if(!/direct_replies|mediaData|thread_items/.test(m[1]))continue;
  try{out.push(JSON.parse(m[1]));}catch{}
 }
 return out;
}
/** A GraphQL response body, with the "for (;;);" prefix Threads adds to some of them. Null when not JSON. */
export function parseBody(text){try{return JSON.parse(String(text).replace(/^for \(;;\);/,''));}catch{return null;}}
/** One post node as a flat record; null when it has no author or code. */
export function toRecord(post){
 const author=lower(post?.user?.username),code=post?.code;
 if(!author||!code)return null;
 const share=post.text_post_app_info?.share_info??{};
 return {id:String(post.pk??post.id??code),author,code,url:`https://www.threads.com/@${author}/post/${code}`,text:String(post.caption?.text??''),postedAt:iso(post.taken_at),replyCount:post.text_post_app_info?.direct_reply_count??null,likeCount:post.like_count??null,isQuote:Boolean(share.quoted_post),isRepost:Boolean(share.reposted_post)};
}
/** Profile page: the owner's own top-level posts (reposts and replies skipped), deduplicated by id, in page order. */
export function profilePosts(trees,username){
 const me=lower(username),seen=new Map();
 for(const tree of trees)for(const e of findAll(tree,'mediaData').flatMap(m=>m?.edges??[])){
  const items=e?.node?.thread_items??[];
  items.forEach((it,i)=>{
   const r=toRecord(it.post);
   // The first item of a thread is the post; later items are replies in the same thread (the owner's follow-ups).
   if(r&&r.author===me&&!r.isRepost&&i===0&&!seen.has(r.id))seen.set(r.id,r);
  });
 }
 return [...seen.values()];
}
/** Profile "Replies" tab: thread_items are [parent, ..., owner's reply]; the owner's replies to someone else's post. */
export function profileReplies(trees,username){
 const me=lower(username),seen=new Map();
 for(const tree of trees)for(const e of findAll(tree,'mediaData').flatMap(m=>m?.edges??[])){
  const items=e?.node?.thread_items??[];
  items.forEach((it,i)=>{
   const r=toRecord(it.post);
   if(!r||r.author!==me||i===0||seen.has(r.id))return;
   const parent=toRecord(items[i-1].post);
   if(!parent||parent.author===me)return;
   seen.set(r.id,{...r,parentUrl:parent.url,parentAuthor:parent.author});
  });
 }
 return [...seen.values()];
}
/** Post page: direct replies under the viewed post, with their authors. */
export function postReplies(trees){
 const seen=new Map();
 for(const tree of trees){
  for(const g of findAll(tree,'direct_replies').flatMap(d=>d?.edges??[]))for(const p of g?.node?.posts?.edges??[]){const r=toRecord(p.node);if(r&&!seen.has(r.id))seen.set(r.id,r);}
  for(const rt of findAll(tree,'reply_threads').flatMap(x=>Array.isArray(x)?x:[]))for(const it of rt?.thread_items??[]){const r=toRecord(it.post);if(r&&!seen.has(r.id))seen.set(r.id,r);}
 }
 return [...seen.values()];
}
export function hasNext(trees,key){return trees.some(t=>findAll(t,key).some(x=>x?.page_info?.has_next_page===true));}
/** The profile owner as the page describes them: display name, follower count, privacy flag. Post authors carry
 *  only a name, so the owner's full record (followers or privacy flag) wins over a name-only one. Null when absent. */
export function profileInfo(trees,username){
 const me=lower(username);let best=null;
 for(const tree of trees)for(const u of findAll(tree,'user')){
  if(!u||lower(u.username)!==me)continue;
  const full=u.follower_count!==undefined||u.text_post_app_is_private!==undefined||u.is_private!==undefined;
  if(full)return {name:u.full_name??null,followers:u.follower_count??null,isPrivate:u.text_post_app_is_private??u.is_private??null};
  best??={name:u.full_name??null,followers:null,isPrivate:null};
 }
 return best;
}
