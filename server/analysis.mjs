import {collectionProfile} from './collection-profile.mjs';
import {describeBehavior} from './behavior-evidence.mjs';
import {analyzeBehavior,BEHAVIOR_VERSION} from './behavior.mjs';
export const RULE_VERSION=BEHAVIOR_VERSION;
export const normalizeText = text => String(text??'').normalize('NFKC').toLowerCase().replace(/https?:\/\/\S+/g,'').replace(/[\p{P}\p{S}\s]/gu,'');
const grams=s=>new Set(Array.from({length:Math.max(0,s.length-2)},(_,i)=>s.slice(i,i+3)));
export function similarity(a,b){a=normalizeText(a);b=normalizeText(b);if(a.length<20||b.length<20)return 0;const x=grams(a),y=grams(b);return 2*[...x].filter(g=>y.has(g)).length/(x.size+y.size);}
const author=s=>String(s??'').replace(/^@/,'').toLowerCase();
function verifiedOwnUrl(value,username){try{const u=new URL(value);const m=u.pathname.match(/^\/@([a-zA-Z0-9_.]+)\/post\/([a-zA-Z0-9_-]+)\/?$/);return u.protocol==='https:'&&['threads.com','www.threads.com','threads.net','www.threads.net'].includes(u.hostname)&&!u.port&&!u.username&&!u.password&&!!m&&author(m[1])===author(username);}catch{return false;}}
export function canonicalParent(value,username){try{const u=new URL(value);const m=u.pathname.match(/^\/@([a-zA-Z0-9_.]+)\/post\/([a-zA-Z0-9_-]+)\/?$/);if(u.protocol!=='https:'||!['threads.com','www.threads.com','threads.net','www.threads.net'].includes(u.hostname)||u.port||u.username||u.password||!m||author(m[1])===author(username))return null;return `https://www.threads.com/@${author(m[1])}/post/${m[2]}`;}catch{return null;}}
const unique=rows=>[...new Map(rows.map(r=>[`${author(r.author)}:${r.id||r.url}`,r])).values()];
const original=r=>!r.isQuote&&!r.isRepost&&normalizeText(r.text).length>=20;
export function analyze(bundle){
 const username=author(bundle.account.username);
 const profile=collectionProfile(bundle.collectionRequest?.id??'standard');
 const posts=unique((bundle.posts??[]).filter(r=>author(r.author)===username&&r.kind==='post')).sort((a,b)=>profile.replyScope!=='all_authored'?0:(Date.parse(b.postedAt)||0)-(Date.parse(a.postedAt)||0)).slice(0,profile.posts);
 const allReplies=unique((bundle.comments??[]).filter(r=>author(r.author)===username&&r.kind==='authored_reply')).sort((a,b)=>profile.replyScope!=='all_authored'?0:(Date.parse(b.postedAt)||0)-(Date.parse(a.postedAt)||0));
 const otherParent=r=>{if(r.parentAuthor)return author(r.parentAuthor)!==username;try{const m=new URL(r.parentUrl).pathname.match(/^\/@([a-zA-Z0-9_.]+)\/post\//);return !!m&&author(m[1])!==username;}catch{return false;}};
 const sampledAuthoredReplies=allReplies.slice(0,profile.replies);
 const comments=profile.replyScope==='all_authored'?sampledAuthoredReplies.filter(otherParent):allReplies.filter(otherParent).slice(0,profile.replies);
 const target=[...posts,...comments], eligible=target.filter(original);
 const comparedIds=new Set(bundle.comparedTargetIds??[]);
 const compared=eligible.filter(r=>comparedIds.has(r.id)&&Number.isFinite(Date.parse(r.postedAt)));
 const comparison=unique(bundle.comparison??[]).filter(r=>author(r.author)&&author(r.author)!==username&&original(r)&&Number.isFinite(Date.parse(r.postedAt)));
 const coordinationGroups=[];
 for(const row of compared){const matches=comparison.filter(r=>Math.abs(Date.parse(r.postedAt)-Date.parse(row.postedAt))<=600000&&similarity(row.text,r.text)>=.85);if(new Set(matches.map(r=>author(r.author))).size>=2)coordinationGroups.push({targetId:row.id,evidence:[row,...matches]});}
 const groups=[];
 for(const row of eligible){const group=groups.find(g=>g.records.every(r=>similarity(row.text,r.text)>=.85));if(group)group.records.push(row);else groups.push({records:[row]});}
 const repeated=groups.filter(g=>g.records.length>1).map(g=>({...g,crossThread:new Set(g.records.filter(r=>r.kind==='authored_reply').map(r=>r.parentUrl).filter(Boolean)).size>1}));
 const c=compared.length>=5&&new Set(comparison.map(r=>author(r.author))).size>=2?coordinationGroups.length/compared.length:null;
 const r=eligible.length?repeated.reduce((n,g)=>n+g.records.length-1,0)/eligible.length:null;
 const exactGroups=new Map();
 for(const row of comments.filter(row=>!row.isQuote&&!row.isRepost&&!original(row))){
   const key=row.text.normalize('NFKC').replace(/\s+/g,' ').trim();
   if(!/https?:\/\//.test(key)&&normalizeText(key).length<8)continue;
   if(!exactGroups.has(key))exactGroups.set(key,[]);exactGroups.get(key).push(row);
 }
 const shortRepeated=[...exactGroups.values()].filter(rows=>rows.length>1&&new Set(rows.map(r=>r.parentUrl).filter(Boolean)).size>1).map(records=>({records,crossThread:true,nonScoring:true}));
 const verified=eligible.filter(row=>Number.isFinite(Date.parse(row.postedAt))&&verifiedOwnUrl(row.url,username)&&row.source&&row.source!=='unknown');
 const verifiedIds=new Set(verified.map(row=>row.id));
 const scoredGroups=repeated.map(group=>{
   const rows=group.records.filter(row=>row.kind==='authored_reply'&&verifiedIds.has(row.id)&&canonicalParent(row.parentUrl,username)).sort((a,b)=>Date.parse(a.postedAt)-Date.parse(b.postedAt));
   let best=[];
   for(const start of rows){const window=rows.filter(row=>Date.parse(row.postedAt)>=Date.parse(start.postedAt)&&Date.parse(row.postedAt)-Date.parse(start.postedAt)<=86400000);if(window.length>best.length&&new Set(window.map(row=>canonicalParent(row.parentUrl,username))).size>=3)best=window;}
   const included=best.length>=3;return {...group,nonScoring:!included,scoring:{included,recordIds:included?best.map(row=>row.id):[],reason:included?'24 小時內至少三個他人串的原創長文近似重複':'未達三個他人串、24 小時或來源門檻'}};
 });
 const ready=verified.length>=5;
 if(!ready)for(const group of scoredGroups){group.nonScoring=true;group.scoring.included=false;group.scoring.reason='有效本人原創樣本不足五筆，尚未計分';}
 const described=describeBehavior({posts,comments,commentsAvailable:bundle.commentsAvailable,allReplyCount:allReplies.length},{similarity,normalizeText,canonicalParent,verifiedOwnUrl,username});
 const assessed=analyzeBehavior({username,posts,comments,allReplies,longGroups:scoredGroups});
 const matches=(bundle.vocabularyEntries??[]).map(v=>{const records=target.filter(r=>r.text?.includes(v.term));return {...v,count:records.reduce((n,r)=>n+r.text.split(v.term).length-1,0),recordIds:records.map(r=>r.id)};}).filter(v=>v.count);
 const limitations=[...(bundle.limitations??[])];
 if(allReplies.length!==comments.length)limitations.push('只計入可辨識為目標在其他帳號串下的留言；自己的串或缺少回覆來源的紀錄已排除。');
 if(!assessed.assessment.eligibleOriginalTexts)limitations.push('本次沒有符合計分條件的原創文本；仍呈現可核對的短句與互動描述。');
 const result={posts,comments,score:assessed.score,coverage:{...(profile.replyScope==='all_authored'?{authoredReplies:{requested:profile.replies,fetched:sampledAuthoredReplies.length,eligibleOtherThreadCount:comments.length,status:sampledAuthoredReplies.length>=profile.replies?'available':sampledAuthoredReplies.length?'partial':'unavailable'}}:{}),posts:{requested:profile.posts,fetched:posts.length,status:posts.length>=profile.posts?'available':posts.length?'partial':'unavailable'},comments:{requested:profile.replies,fetched:comments.length,status:!bundle.commentsAvailable?'unavailable':comments.length>=profile.replies?'available':'partial'},comparison:{records:comparison.length,accounts:new Set(comparison.map(r=>author(r.author))).size,comparedTargetCount:compared.length},limitations:[...new Set(limitations)]},analysis:{coordination:{status:'context_only',summary:compared.length?`有限語料：${comparison.length} 筆、${new Set(comparison.map(r=>author(r.author))).size} 名其他作者；在 ${compared.length} 筆目標文本中找到 ${coordinationGroups.length} 組同步近似文字。未充分評估協同，不計分。`:`本次沒有完成跨帳號比對；保留 ${comparison.length} 筆、${new Set(comparison.map(r=>author(r.author))).size} 名其他作者的參考語料。協同尚未充分評估，不計分。`,groups:coordinationGroups},repetition:{status:r!==null||shortRepeated.length?'available':'unavailable',summary:`${r===null?'沒有足夠的原創長文本':`找到 ${repeated.length} 組重複長文本`}；另有 ${shortRepeated.length} 組跨串相同短句或連結（僅展示，不計分）。`,groups:[...scoredGroups,...shortRepeated]},vocabulary:{status:bundle.vocabularyEntries?.length?'available':'unavailable',matches,sourceUrl:'https://invade.tw/vocabs'},factChecks:bundle.factChecks??{status:'unavailable',items:[]}}};
 return {...result,...(profile.replyScope==='all_authored'?{collectionRequest:profile,authoredReplies:sampledAuthoredReplies}:{}),analysis:{...result.analysis,behavior:described,behaviorAssessment:assessed.assessment,interactionConcentration:assessed.concentration,repetition:{status:assessed.assessment.status,summary:assessed.assessment.summary,groups:[...scoredGroups,...shortRepeated.filter(g=>!assessed.shortGroups.some(s=>s.records.length===g.records.length&&s.records.every(r=>g.records.some(x=>x.id===r.id)))),...assessed.shortGroups,...assessed.templateGroups,...assessed.commonGroups]}}};
}
