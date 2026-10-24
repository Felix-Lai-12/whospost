// Product thresholds, not validated attribution criteria. Count observed signals only.
export const norm=t=>String(t||'').normalize('NFKC').replace(/\s+/g,' ').trim();
export const bare=t=>norm(t).replace(/[\p{P}\p{S}\s]/gu,'');
export const common=t=>/^(?:讚|棒|加油|辛苦了|早安|晚安|生日快樂|恭喜|謝謝分享|感謝分享|您好|謝謝|感謝|哈哈|呵呵|ㄎ|ㄘ|支持)+$/u.test(bare(t));
const unique=rs=>[...new Map(rs.filter(r=>r.url&&r.text&&!r.isQuote&&!r.isRepost).map(r=>[r.url,r])).values()];
const maxSame=rs=>{const m=new Map();for(const r of rs.filter(r=>!common(r.text))){const k=norm(r.text);m.set(k,(m.get(k)||0)+1)}return Math.max(0,...m.values())};
const pct=n=>`${Math.round(n*100)}%`;
const SHORT_CHARS=4,SHORT_RATIO=.8,BURST_SECONDS=10,BURST_MIN=3;
function parentOf(r,username){try{const u=new URL(r.parentUrl);const m=u.pathname.match(/^\/@([^/]+)\/post\/([^/]+)$/);if(!m||m[1].toLowerCase()===String(username||'').toLowerCase())return null;return {path:u.pathname,author:m[1]}}catch{return null}}
// Shared with the server so a partner account's saved scan can be checked for mutual concentration.
export function topReplyTarget(scan){
 const comments=unique(scan.comments||[]),byAuthor=new Map();let known=0;
 for(const r of comments){const p=parentOf(r,scan.account?.username);if(!p)continue;known++;byAuthor.set(p.author,(byAuthor.get(p.author)||0)+1)}
 const [author,count]=[...byAuthor.entries()].sort((a,b)=>b[1]-a[1])[0]??[null,0];
 return {author,count,known,share:known?count/known:0,complete:known===comments.length};
}
/** A follower count as stored: a whole number of zero or more, else null (not obtained). Zero is a real count, so a
 *  missing one is never shown or treated as zero. */
export const followerCount=v=>Number.isSafeInteger(v)&&v>=0?v:null;
// Popularity tiers for the reply target of author-focus (EXTENSION-SPEC §4.4, plan-detection-precision S3): replying
// mostly to one big account is what ordinary fans do, so the tier is kept beside the rule as evidence. Described only:
// the rule's hit, value and threshold do not change until calibration (§10 #1). Tiers are lower bounds, ascending.
export const POPULARITY_TIERS=Object.freeze([
 Object.freeze({id:'small',min:0,label:'一般帳號'}),
 Object.freeze({id:'mid',min:10000,label:'萬粉帳號'}),
 Object.freeze({id:'large',min:100000,label:'十萬粉帳號'}),
 Object.freeze({id:'huge',min:1000000,label:'百萬粉帳號'})
]);
/** The tier for a follower count, or null when the count was not obtained. */
export function popularityTier(followers){const n=followerCount(followers);if(n===null)return null;let tier=POPULARITY_TIERS[0];for(const t of POPULARITY_TIERS)if(n>=t.min)tier=t;return tier;}
const fmtCount=n=>n.toLocaleString('en-US');
/** author-focus evidence: who the replies go to most, that account's follower count from its own saved scan (null when
 *  it was never scanned or the scan did not get one), its tier, and a plain sentence. Never feeds the score. */
export function authorFocusEvidence(scan){
 const top=topReplyTarget(scan),m=scan.mutual;
 const same=top.author&&m&&String(m.partner||'').toLowerCase()===top.author.toLowerCase();
 const partnerFollowers=same&&m.scanned===true?followerCount(m.partnerFollowers):null,tier=popularityTier(partnerFollowers);
 const note=!top.author?'沒有可確認對象的留言':partnerFollowers===null?`@${top.author} 的粉絲數未取得`:`@${top.author} 有 ${fmtCount(partnerFollowers)} 位粉絲（${tier.label}）；集中回覆熱門帳號也常見於一般粉絲，這點尚未計入分數`;
 return {partner:top.author,partnerFollowers,popularityTier:tier?.id??null,note};
}
export function signalScore(scan){
 const posts=unique(scan.posts||[]),comments=unique(scan.comments||[]),a=scan.analysis||{},username=scan.account?.username;
 // Content checks do not need a parent thread, so use every authored reply when the scan kept them.
 const ownReplies=unique(scan.authoredReplies||scan.comments||[]);
 // Exact and similar posts are one dimension: count posts in any repeated group once.
 const repeatedPosts=new Set(),textCount=new Map();
 for(const p of posts.filter(p=>!common(p.text))){const k=norm(p.text);textCount.set(k,[...(textCount.get(k)||[]),p.url])}
 for(const urls of textCount.values())if(urls.length>1)urls.forEach(u=>repeatedPosts.add(u));
 for(const g of a.repetition?.groups||[]){const rows=g.records||[];if(g.type==='common_short'||new Set(rows.map(r=>norm(r.text))).size<2)continue;for(const r of rows)if(posts.some(p=>p.url===r.url))repeatedPosts.add(r.url)}
 const exactComments=maxSame(ownReplies),shortComments=ownReplies.filter(r=>bare(r.text).length<=SHORT_CHARS).length;
 const byParent=new Map();for(const r of comments){const p=parentOf(r,username);if(p)byParent.set(p.path,(byParent.get(p.path)||0)+1)}
 const top=topReplyTarget(scan),maxParent=Math.max(0,...byParent.values());
 const timed=comments.filter(r=>parentOf(r,username)&&Number.isFinite(Date.parse(r.postedAt))).sort((x,y)=>Date.parse(x.postedAt)-Date.parse(y.postedAt));
 let bursts=0;for(let i=1;i<timed.length;i++)if(timed[i].parentUrl===timed[i-1].parentUrl&&(Date.parse(timed[i].postedAt)-Date.parse(timed[i-1].postedAt))/1000<=BURST_SECONDS)bursts++;
 const concentrated=top.complete&&top.known>=6&&top.share>=.5,partner=scan.mutual;
 const mutualHit=concentrated&&partner?.scanned===true&&String(partner.partnerTopAuthor||'').toLowerCase()===String(username||'').toLowerCase()&&partner.partnerShare>=.5;
 const mutualDetail=!concentrated?`沒有過半留言集中回覆同一作者`:partner?.scanned!==true?`@${top.author} 尚未查詢，無法確認是否互相集中`:mutualHit?`@${top.author} 也有 ${pct(partner.partnerShare)} 留言回覆本帳號`:`@${top.author} 的留言主要回覆 @${partner.partnerTopAuthor||'其他帳號'}`;
 const rule=(id,label,hit,observable,detail)=>({id,label,status:hit?'yes':observable?'no':'unknown',contribution:hit?1:0,detail});
 const items=[
 rule('content-posts','一半以上的貼文內容相同或相似',posts.length>=6&&repeatedPosts.size/posts.length>=.5,posts.length>=6,posts.length>=6?`${repeatedPosts.size}/${posts.length} 篇貼文屬於相同或相似內容`:`只取得 ${posts.length} 篇貼文，至少 6 篇才能判讀`),
 rule('content-comments','留言大量重複，或八成以上是極短反應詞',ownReplies.length>=6&&(exactComments>5||shortComments/ownReplies.length>=SHORT_RATIO),ownReplies.length>=6,ownReplies.length>=6?`最多 ${exactComments} 則相同留言（排除常見寒暄）；${shortComments}/${ownReplies.length} 則在 ${SHORT_CHARS} 字以內`:`只取得 ${ownReplies.length} 則留言，至少 6 則才能判讀`),
 {...rule('author-focus','回覆超過 10 篇貼文，且至少一半留言給同一作者',byParent.size>10&&top.complete&&top.share>=.5,top.complete&&top.known>=11,`${byParent.size} 篇不同貼文；同一作者 ${top.count}/${top.known} 則可確認留言`),evidence:authorFocusEvidence(scan)},
 rule('thread-focus','在同一篇貼文下留言超過 10 次',maxParent>10,top.complete&&top.known>=11,`同一篇最多 ${maxParent} 則留言`),
 rule('mutual-focus','和最常回覆的帳號互相集中回覆',mutualHit,top.complete&&top.known>=6&&(!concentrated||partner?.scanned===true),mutualDetail),
 rule('burst-replies',`同一篇貼文下 ${BURST_SECONDS} 秒內連續留言至少 ${BURST_MIN} 次`,bursts>=BURST_MIN,timed.length>=6,`${bursts} 次在同一篇貼文下 ${BURST_SECONDS} 秒內連續留言`)
 ];
 const assessed=items.filter(r=>r.status!=='unknown').length;
 return {value:assessed?items.reduce((n,r)=>n+r.contribution,0):null,version:'signals-v2',scope:'observed-signal-count',items,assessed,unknown:items.length-assessed,reason:'每個符合條件加1；暫定產品門檻，非網軍機率。'};
}
