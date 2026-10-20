// Product thresholds, not validated attribution criteria. Count observed signals only.
const norm=t=>String(t||'').normalize('NFKC').replace(/\s+/g,' ').trim();
const bare=t=>norm(t).replace(/[\p{P}\p{S}\s]/gu,'');
const common=t=>/^(?:讚|棒|加油|辛苦了|早安|晚安|生日快樂|恭喜|謝謝分享|感謝分享|您好|謝謝|感謝|哈哈|呵呵|ㄎ|ㄘ|支持)+$/u.test(bare(t));
const unique=rs=>[...new Map(rs.filter(r=>r.url&&r.text&&!r.isQuote&&!r.isRepost).map(r=>[r.url,r])).values()];
const maxSame=rs=>{const m=new Map();for(const r of rs.filter(r=>!common(r.text))){const k=norm(r.text);m.set(k,(m.get(k)||0)+1)}return Math.max(0,...m.values())};
const pct=n=>`${Math.round(n*100)}%`;
const SHORT_CHARS=4,SHORT_RATIO=.8,BURST_SECONDS=10,BURST_MIN=3;
// Display only. Three groups for groupsHit: hits inside one group often share a single cause; hits across
// groups are the independent clues. Counting groups never changes the score.
export const SIGNAL_GROUPS=[{id:'content',label:'內容',items:['content-posts','content-comments']},{id:'relation',label:'關係',items:['author-focus','thread-focus','mutual-focus']},{id:'time',label:'時間',items:['burst-replies']}];
// Per-rule caveats quoted from SCORING.md: who else can match, and what the rule cannot see. Not new judgements.
const WHY={
 'content-posts':'不能只用立場或內容判定身分；短口號樣板（只換人名）目前相似規則抓不到。',
 'content-comments':'極短反應詞含常見寒暄；一般人也常回「笑死」，所以門檻設 80%。',
 'author-focus':'分母是本次納入的可核對留言，不是完整歷史；粉絲／客服／朋友皆可能符合。',
 'thread-focus':'門檻由產品暫訂，尚無校準資料；來源也沒有支持這類通用臨界值。',
 'mutual-focus':'對方沒查過時顯示未知，伺服器不會為此自動抓取；本帳號沒有過半集中時判為不符合。',
 'burst-replies':'跨不同貼文的快速留言不計，因為正常帳號（如本地對照帳號）也常在 1 分鐘內回覆不同串。'
};
const groupOf=id=>SIGNAL_GROUPS.find(g=>g.items.includes(id))?.id??null;
// Overview sentence: zero hits means the rules saw nothing, not that the account is normal.
function caveatFor(items){
 const assessed=items.filter(r=>r.status!=='unknown'),hits=items.filter(r=>r.status==='yes'),unknown=items.length-assessed.length;
 const unknownNote=unknown?`另有 ${unknown} 項資料不足，未判讀。`:'';
 if(!assessed.length)return '六項都資料不足，無法判讀；這不代表帳號正常，也不代表可疑。';
 if(!hits.length)return `${unknown?`已判讀的 ${assessed.length} 項`:'六項'}都未觀察到，不代表帳號正常，只代表這套規則沒有觀察到。${unknownNote}`;
 return `觀察到 ${hits.length} 項，這只是這套規則的觀察結果，不是身分判定；一般帳號也可能符合，請對照下方原文。${unknownNote}`;
}
function parentOf(r,username){try{const u=new URL(r.parentUrl);const m=u.pathname.match(/^\/@([^/]+)\/post\/([^/]+)$/);if(!m||m[1].toLowerCase()===String(username||'').toLowerCase())return null;return {path:u.pathname,author:m[1]}}catch{return null}}
// Shared with the server so a partner account's saved scan can be checked for mutual concentration.
export function topReplyTarget(scan){
 const comments=unique(scan.comments||[]),byAuthor=new Map();let known=0;
 for(const r of comments){const p=parentOf(r,scan.account?.username);if(!p)continue;known++;byAuthor.set(p.author,(byAuthor.get(p.author)||0)+1)}
 const [author,count]=[...byAuthor.entries()].sort((a,b)=>b[1]-a[1])[0]??[null,0];
 return {author,count,known,share:known?count/known:0,complete:known===comments.length};
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
 const rule=(id,label,hit,observable,detail)=>({id,label,status:hit?'yes':observable?'no':'unknown',contribution:hit?1:0,detail,why:WHY[id],group:groupOf(id)});
 const items=[
 rule('content-posts','一半以上的貼文內容相同或相似',posts.length>=6&&repeatedPosts.size/posts.length>=.5,posts.length>=6,posts.length>=6?`${repeatedPosts.size}/${posts.length} 篇貼文屬於相同或相似內容`:`只取得 ${posts.length} 篇貼文，至少 6 篇才能判讀`),
 rule('content-comments','留言大量重複，或八成以上是極短反應詞',ownReplies.length>=6&&(exactComments>5||shortComments/ownReplies.length>=SHORT_RATIO),ownReplies.length>=6,ownReplies.length>=6?`最多 ${exactComments} 則相同留言（排除常見寒暄）；${shortComments}/${ownReplies.length} 則在 ${SHORT_CHARS} 字以內`:`只取得 ${ownReplies.length} 則留言，至少 6 則才能判讀`),
 rule('author-focus','回覆超過 10 篇貼文，且至少一半留言給同一作者',byParent.size>10&&top.complete&&top.share>=.5,top.complete&&top.known>=11,`${byParent.size} 篇不同貼文；同一作者 ${top.count}/${top.known} 則可確認留言`),
 rule('thread-focus','在同一篇貼文下留言超過 10 次',maxParent>10,top.complete&&top.known>=11,`同一篇最多 ${maxParent} 則留言`),
 rule('mutual-focus','和最常回覆的帳號互相集中回覆',mutualHit,top.complete&&top.known>=6&&(!concentrated||partner?.scanned===true),mutualDetail),
 rule('burst-replies',`同一篇貼文下 ${BURST_SECONDS} 秒內連續留言至少 ${BURST_MIN} 次`,bursts>=BURST_MIN,timed.length>=6,`${bursts} 次在同一篇貼文下 ${BURST_SECONDS} 秒內連續留言`)
 ];
 const assessed=items.filter(r=>r.status!=='unknown').length;
 const groupsHit={count:0,total:SIGNAL_GROUPS.length};for(const g of SIGNAL_GROUPS){groupsHit[g.id]=items.some(r=>r.group===g.id&&r.status==='yes');if(groupsHit[g.id])groupsHit.count++;}
 return {value:assessed?items.reduce((n,r)=>n+r.contribution,0):null,version:'signals-v2',scope:'observed-signal-count',items,assessed,unknown:items.length-assessed,reason:'每個符合條件加1；暫定產品門檻，不是身分判定或機率。',caveat:caveatFor(items),groupsHit};
}
