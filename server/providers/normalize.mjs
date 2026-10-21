const clean = value => typeof value === 'string' ? value : '';
const username = value => clean(value).replace(/^@/, '').toLowerCase();
export function safeThreadsUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && ['threads.com','www.threads.com','threads.net','www.threads.net'].includes(url.hostname) && !url.username && !url.password ? url.href : null; } catch { return null; }
}
function date(value) { if (value == null) return null; const d = new Date(typeof value === 'number' ? value * 1000 : value); return Number.isFinite(d.getTime()) ? d.toISOString() : null; }
export function normalizeAutomation(row, kind = 'post') {
  if (row?.type !== 'post' || !row.postId || !username(row.username) || !safeThreadsUrl(row.url)) return null;
  return {id:String(row.postId),author:username(row.username),kind,text:clean(row.text),postedAt:date(row.date ?? row.timestamp),url:safeThreadsUrl(row.url),parentUrl:null,parentAuthor:null,isQuote:Boolean(row.quoted_post_url || row.quotedPostUrl || row.isQuote || row.isQuotePost),isRepost:Boolean(row.isRepost || row.repostedFrom),isReply:Boolean(row.isReply),source:'automation-lab/threads-scraper'};
}
export function normalizeAuthoredReply(row, target) {
  if (row?.record_type !== 'reply' || row.is_reply !== true || username(row.username) !== username(target) || !row.id || !safeThreadsUrl(row.url)) return null;
  return {id:String(row.id),author:username(row.username),kind:'authored_reply',text:clean(row.text),postedAt:date(row.posted_at),url:safeThreadsUrl(row.url),parentUrl:safeThreadsUrl(row.reply_to_url),parentAuthor:username(row.reply_to_author) || null,isQuote:Boolean(row.quoted_post_url),isRepost:Boolean(row.reposted_by),isReply:true,source:'benthepythondev/threads-user-posts-scraper'};
}
export function uniqueRecent(rows, limit) {
  return [...new Map(rows.filter(Boolean).map(row => [row.id,row])).values()].sort((a,b)=>(Date.parse(b.postedAt)||0)-(Date.parse(a.postedAt)||0)).slice(0,limit);
}
export function searchTargets(posts) {
  const seen = new Set();
  return posts.filter(p=>!p.isReply&&!p.isQuote&&!p.isRepost).map(p=>({id:p.id,query:p.text.replace(/https?:\/\/\S+/g,'').replace(/\s+/g,' ').trim().slice(0,80)})).filter(p=>p.query.length>=20&&!seen.has(p.query)&&seen.add(p.query)).slice(0,5);
}

export function normalizeSupplementPost(row,target){
 if(row?.record_type!=='post'||row.is_reply||username(row.username)!==username(target)||!row.id||!safeThreadsUrl(row.url))return null;
 return {id:String(row.id),author:username(row.username),kind:'post',text:clean(row.text),postedAt:date(row.posted_at),url:safeThreadsUrl(row.url),parentUrl:null,parentAuthor:null,isQuote:Boolean(row.quoted_post_url),isRepost:Boolean(row.reposted_by),isReply:false,source:'benthepythondev/threads-user-posts-scraper'};
}
export function relaxedTargets(rows){
 const seen=new Set();return rows.filter(p=>!p.isQuote&&!p.isRepost&&p.text.replace(/https?:\/\/\S+/g,'').replace(/[\p{P}\p{S}\s]/gu,'').length>=20).map(p=>{
 const text=p.text.replace(/https?:\/\/\S+/g,'').trim();
 const named=text.match(/[a-zA-Z][a-zA-Z0-9_-]{4,}/);
 const phrase=text.split(/[，。！？\n,.!?]/).map(s=>s.replace(/@\S+/g,'').trim()).find(s=>s.length>=6);
 return {id:p.id,query:named?named[0]:String(phrase||text).slice(0,14)};
 }).filter(x=>!seen.has(x.query.toLowerCase())&&seen.add(x.query.toLowerCase())).slice(0,5);
}
// Rows from the browser provider (threads-embedded.mjs records) in the same shape as the Apify rows above.
export function normalizeBrowserPost(row,target){
 if(!row||username(row.author)!==username(target)||!row.id||!safeThreadsUrl(row.url))return null;
 return {id:String(row.id),author:username(row.author),kind:'post',text:clean(row.text),postedAt:date(row.postedAt),url:safeThreadsUrl(row.url),parentUrl:null,parentAuthor:null,isQuote:Boolean(row.isQuote),isRepost:Boolean(row.isRepost),isReply:false,replyCount:Number.isFinite(row.replyCount)?row.replyCount:null,source:'cloudflare-browser'};
}
export function normalizeBrowserReply(row,target){
 if(!row||username(row.author)!==username(target)||!row.id||!safeThreadsUrl(row.url))return null;
 return {id:String(row.id),author:username(row.author),kind:'authored_reply',text:clean(row.text),postedAt:date(row.postedAt),url:safeThreadsUrl(row.url),parentUrl:safeThreadsUrl(row.parentUrl),parentAuthor:username(row.parentAuthor)||null,isQuote:Boolean(row.isQuote),isRepost:Boolean(row.isRepost),isReply:true,source:'cloudflare-browser'};
}
