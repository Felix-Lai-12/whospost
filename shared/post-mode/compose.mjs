// Who is commenting under one post: account labels, their shares, and how they compare with a baseline post.
// Describes the crowd, never judges a single account; see POST-MODE-SPEC-20261021.md §4.
import {analyzeBehavior,validComments,handle} from './analyze.mjs';

export const VERSION='post-phase0-v1-composition';
export const COMPOSE_RULES={
  minAccounts:20,        // fewer distinct commenters → insufficient_data
  lowFollowers:10,
  regularMinPosts:2,     // other analysed posts, by authors other than this post's author
  headlineMinCount:5,
  headlineMinRatio:2,    // vs baseline
};
// test(account) returns true / false / null (unknown). Shares only count accounts where the answer is known.
export const LABELS=[
  {key:'lowFollowers',name:`追蹤數少於 ${COMPOSE_RULES.lowFollowers}`,source:'profile',test:a=>!Number.isFinite(a.profile?.followers)||a.profile.followers<0?null:a.profile.followers<COMPOSE_RULES.lowFollowers},
  {key:'noAvatar',name:'沒有大頭貼',source:'thread',test:a=>{const v=a.profile?.hasAvatar??a.meta.hasAvatar;return v==null?null:!v;}},
  {key:'emptyBio',name:'沒有簡介',source:'profile',test:a=>a.profile?.bio==null?null:a.profile.bio===''},
  {key:'digitHandle',name:'帳號名結尾有 4 位以上數字',source:'thread',test:a=>/\d{4,}$/.test(a.author)},
  {key:'private',name:'私人帳號',source:'profile',test:a=>a.profile?.isPrivate??null},
  {key:'burst',name:'在這串參與同文湧入',source:'thread',test:a=>a.behavior.includes('P1+P2')},
  {key:'flood',name:'在這串洗版',source:'thread',test:a=>a.behavior.includes('P3')},
  {key:'regular',name:`也出現在其他作者的已分析貼文底下（≥${COMPOSE_RULES.regularMinPosts} 篇）`,source:'corpus',test:a=>a.corpusSize?a.otherPosts.length>=COMPOSE_RULES.regularMinPosts:null},
  {key:'verified',name:'認證帳號',source:'thread',test:a=>a.profile?.verified??a.meta.verified??null},
  {key:'scanned',name:'Whospost 帳號模式查過',source:'db',test:a=>a.known!==null},
];
const NEUTRAL=new Set(['verified','scanned']);   // shown, never used as the headline
const pct=x=>`${Math.round(x*100)}%`;

/**
 * input: {post, comments}. profiles: {username: profile} (may cover only a sample).
 * corpus: earlier analyses [{post:{code,author}, accounts:[{author}]}]. known: {username: account-mode summary}.
 * baseline: another analysis's output (its composition is the comparison).
 */
export function composePost(input,{profiles={},corpus=[],known={},baseline=null}={}){
  const {post={}}=input,{valid,coverage}=validComments(input),behavior=analyzeBehavior(input);
  const byAuthor=new Map();valid.forEach(c=>byAuthor.set(handle(c.author),[...(byAuthor.get(handle(c.author))??[]),c]));
  const others=corpus.filter(o=>o?.post?.code&&o.post.code!==post.code&&handle(o.post.author)!==handle(post.author));
  const seen=new Map();others.forEach(o=>new Set((o.accounts??[]).map(a=>handle(a.author))).forEach(u=>seen.set(u,[...(seen.get(u)??[]),{code:o.post.code,author:o.post.author}])));
  const flaggedBy=new Map();behavior.flagged.forEach(f=>flaggedBy.set(f.author,[...new Set([...(flaggedBy.get(f.author)??[]),...f.reasons.map(r=>r.rule)])]));

  const accounts=[...byAuthor].map(([author,rows])=>{
    const a={author,comments:rows.length,firstAt:rows.map(r=>r.postedAt).sort()[0],commentIds:rows.map(r=>r.id),
      meta:rows[0].authorMeta??{},profile:profiles[author]??null,behavior:flaggedBy.get(author)??[],
      otherPosts:seen.get(author)??[],corpusSize:others.length,known:known[author]??null};
    a.labels=LABELS.filter(l=>l.test(a)===true).map(l=>l.key);
    return a;
  });
  const profiled=accounts.filter(a=>a.profile).length;
  const base={version:VERSION,rules:COMPOSE_RULES,post,coverage:{...coverage,accounts:accounts.length,profiled,corpusPosts:others.length},behavior};
  if(accounts.length<COMPOSE_RULES.minAccounts)
    return {...base,status:'insufficient_data',reason:`留言者只有 ${accounts.length} 位（至少 ${COMPOSE_RULES.minAccounts} 位才分析組成）；看不出組成不代表這串很正常。`,composition:[],accounts:[]};

  const baseRows=new Map((baseline?.composition??[]).map(r=>[r.key,r]));
  const composition=LABELS.map(l=>{
    const answers=accounts.map(a=>l.test(a)),known=answers.filter(v=>v!==null).length,count=answers.filter(v=>v===true).length;
    const share=known?count/known:null,b=baseRows.get(l.key);
    const ratio=share!==null&&b?.share>0?share/b.share:null;
    // A zero baseline has no ratio; it still counts as "higher" when the baseline had enough accounts to mean it.
    const aboveZero=share>0&&b?.share===0&&b.known>=COMPOSE_RULES.minAccounts;
    return {key:l.key,name:l.name,source:l.source,count,known,share:share===null?null:+share.toFixed(3),
      baseline:b?{share:b.share,known:b.known,code:baseline.post?.code??null}:null,ratio:ratio===null?null:+ratio.toFixed(2),aboveZero};
  });

  const total=accounts.length,cands=composition.filter(r=>!NEUTRAL.has(r.key)&&r.count>=COMPOSE_RULES.headlineMinCount);
  const vsBase=cands.filter(r=>r.aboveZero||r.ratio!==null&&r.ratio>=COMPOSE_RULES.headlineMinRatio).sort((a,b)=>b.aboveZero-a.aboveZero||b.ratio-a.ratio)[0];
  const top=[...cands].sort((a,b)=>b.share-a.share)[0];
  const sampleNote=r=>r.source==='profile'&&r.known<total?`（以有抓個人頁的 ${r.known} 位計）`:'';
  const headline=vsBase?`${total} 位留言者中，${pct(vsBase.share)}${sampleNote(vsBase)} ${vsBase.name}，${vsBase.aboveZero?'對照貼文是 0%':`是對照貼文的 ${vsBase.ratio} 倍`}。`
    :top&&!baseline?`${total} 位留言者中，${pct(top.share)}${sampleNote(top)} ${top.name}。沒有對照貼文，看不出這個比例算高還低。`
    :top&&cands.some(r=>r.baseline?.share!=null)?`${total} 位留言者的組成跟對照貼文差不多，沒有哪一項高出 ${COMPOSE_RULES.headlineMinRatio} 倍。`
    :top?`${total} 位留言者中，${pct(top.share)}${sampleNote(top)} ${top.name}；對照資料不足，無法比較高低。`
    :`${total} 位留言者中，沒有任何一項特徵超過 ${COMPOSE_RULES.headlineMinCount} 位。`;

  const suspicious=a=>a.labels.filter(k=>!NEUTRAL.has(k)).length;
  return {...base,status:'ok',headline,composition,
    regulars:accounts.filter(a=>a.otherPosts.length>=COMPOSE_RULES.regularMinPosts).map(a=>({author:a.author,posts:a.otherPosts})).sort((a,b)=>b.posts.length-a.posts.length),
    accounts:accounts.map(({meta,corpusSize,...a})=>a).sort((a,b)=>suspicious(b)-suspicious(a)||b.comments-a.comments)};
}
