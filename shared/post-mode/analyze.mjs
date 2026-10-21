// Behaviour layer: what commenters did inside this one thread (P1–P3). compose.mjs turns it into account labels.
// Flags describe behaviour only, never identity; see POST-MODE-SPEC-20261021.md §4.
import {normalizeText,similarity} from '../../server/analysis.mjs';

export const RULES={
  minTextLength:8,         // normalized chars; drops 寒暄, emoji, bare links
  nearSimilarity:0.85,     // same threshold as account mode; only applies to ≥20 normalized chars
  minGroupAuthors:3,       // P1: distinct accounts in one same/near-same group
  burstWindowMs:10*60e3,   // P2: group span
  burstDensityRatio:2.5,   // P2: group rate ÷ whole-thread rate; a post where everyone piles in at once is not a burst
  floodMinComments:5,      // P3
  floodMinShare:0.10,
};
// Posts that ask readers to comment (抽獎、接龍) make identical comments expected, so P1 groups there don't flag.
const PROMPTED=/(留言|tag|標註|標記|抽獎|抽出|\+1|接龍|分享給)/i;

export const handle=s=>String(s??'').replace(/^@/,'').toLowerCase();
const time=s=>{const t=Date.parse(s);return Number.isFinite(t)?t:null;};

function groupsOf(rows){
  const parent=rows.map((_,i)=>i),find=i=>parent[i]===i?i:(parent[i]=find(parent[i]));
  const union=(a,b)=>{a=find(a);b=find(b);if(a!==b)parent[b]=a;};
  const byNorm=new Map();
  rows.forEach((r,i)=>{const k=byNorm.get(r.norm);k===undefined?byNorm.set(r.norm,i):union(k,i);});
  const reps=[...byNorm.values()];
  for(let a=0;a<reps.length;a++)for(let b=a+1;b<reps.length;b++)
    if(similarity(rows[reps[a]].text,rows[reps[b]].text)>=RULES.nearSimilarity)union(reps[a],reps[b]);
  const out=new Map();
  rows.forEach((r,i)=>{const k=find(i);out.set(k,[...(out.get(k)??[]),r]);});
  return [...out.values()];
}

/** Valid comments (id, author, text, time; post author excluded) plus coverage counts. */
export function validComments({post={},comments=[]}){
  const valid=comments.filter(c=>c?.id&&handle(c.author)&&String(c.text??'').trim()&&time(c.postedAt)!==null)
    .filter(c=>handle(c.author)!==handle(post.author));
  return {valid,coverage:{fetched:comments.length,valid:valid.length,shownOnPost:Number.isFinite(post.replyCountShown)?post.replyCountShown:null,
    excludedPostAuthor:comments.filter(c=>handle(c?.author)&&handle(c.author)===handle(post.author)).length}};
}

export function analyzeBehavior(input){
  const {post={}}=input,{valid}=validComments(input);
  if(!valid.length)return {prompted:false,groups:[],floods:[],flagged:[]};
  const times=valid.map(c=>time(c.postedAt)).sort((a,b)=>a-b);
  const threadRate=valid.length/Math.max(times.at(-1)-times[0],60e3);
  const prompted=PROMPTED.test(String(post.text??''));
  const authorsTotal=new Set(valid.map(c=>handle(c.author))).size;

  // P1 + P2
  const eligible=valid.map(c=>({...c,norm:normalizeText(c.text)})).filter(c=>c.norm.length>=RULES.minTextLength);
  const groups=groupsOf(eligible).map(rows=>{
    const authors=[...new Set(rows.map(r=>handle(r.author)))];
    if(authors.length<RULES.minGroupAuthors)return null;
    const ts=rows.map(r=>time(r.postedAt)).sort((a,b)=>a-b),span=ts.at(-1)-ts[0];
    const ratio=(rows.length/Math.max(span,60e3))/threadRate;
    const burst=span<=RULES.burstWindowMs&&ratio>=RULES.burstDensityRatio;
    return {sample:rows[0].text,size:rows.length,authors,
      idfWeight:+(1/Math.log2(1+authors.length)).toFixed(3),authorShare:+(authors.length/authorsTotal).toFixed(3),
      spanMinutes:+(span/60e3).toFixed(1),densityRatio:+ratio.toFixed(2),
      p1:true,p2:burst,flag:burst&&!prompted,
      why:prompted?'貼文本身要求留言，相同留言是預期行為，不標記。':burst?`${authors.length} 個帳號在 ${(span/60e3).toFixed(1)} 分鐘內留下相同或近似文字，密度是整串平均的 ${ratio.toFixed(1)} 倍。`:'相同或近似文字，但沒有集中在短時間內，不標記。',
      commentIds:rows.map(r=>r.id)};
  }).filter(Boolean).sort((a,b)=>b.size-a.size);

  // P3
  const perAuthor=new Map();valid.forEach(c=>perAuthor.set(handle(c.author),[...(perAuthor.get(handle(c.author))??[]),c]));
  const floods=[...perAuthor].filter(([,rows])=>rows.length>=RULES.floodMinComments&&rows.length/valid.length>=RULES.floodMinShare)
    .map(([author,rows])=>({author,count:rows.length,share:+(rows.length/valid.length).toFixed(3),flag:true,
      why:`同一帳號在這串留了 ${rows.length} 則，占取回留言 ${Math.round(rows.length/valid.length*100)}%。`,commentIds:rows.map(r=>r.id)}));

  const reasons=new Map();
  for(const g of groups)if(g.flag)g.commentIds.forEach(id=>reasons.set(id,[...(reasons.get(id)??[]),{rule:'P1+P2',why:g.why}]));
  for(const f of floods)f.commentIds.forEach(id=>reasons.set(id,[...(reasons.get(id)??[]),{rule:'P3',why:f.why}]));
  const flagged=valid.filter(c=>reasons.has(c.id)).map(c=>({id:c.id,author:handle(c.author),reasons:reasons.get(c.id)}));
  return {prompted,groups,floods,flagged};
}
