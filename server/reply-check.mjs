// The server's spot check of replies the extension sent (plan-extension-replies 2026-10-29, trust layer 2): a few rows,
// picked at random, are fetched again logged out and compared with what was sent. Measured 2026-10-29 from a Mac with
// the precheck's crawler agent: a reply's own page answers 200 with og:url naming its author and code and og:description
// carrying its text in full (none when the reply has no text); a made-up code is redirected to /?error=invalid_post; a
// real code under the wrong author is redirected (301) to the right one. The time needs no fetch (shared/reply-rows.mjs).
// The parent is not on that page, so who a reply answered is not checked here.
import {AGENT} from './providers/threads-profile.mjs';
import {postLink} from '../shared/reply-rows.mjs';
export const SPOT_CHECKS=2;
const MAX_BYTES=2097152,TIMEOUT_MS=10000;
const ENTITIES={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};
const unescape=s=>s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,(m,e)=>e[0]!=='#'?ENTITIES[e.toLowerCase()]??m:String.fromCodePoint(e[1].toLowerCase()==='x'?parseInt(e.slice(2),16):Number(e.slice(1))));
const meta=(html,property)=>{const m=html.match(new RegExp(`<meta[^>]*property="${property}"[^>]*content="([^"]*)"`));return m?unescape(m[1]):null;};
const same=t=>String(t??'').normalize('NFKC').replace(/\s+/g,' ').trim();
/** What a logged-out fetch of one post page says: {status:'found', author, code, text}, 'missing' (Threads says there
 *  is no such post, or sends it to another author), or 'unknown' (anything we cannot read: a login wall, an error). */
export async function readPost(url,{fetchImpl}){
 let r;try{r=await fetchImpl(url,{headers:{'User-Agent':AGENT,Accept:'text/html'},redirect:'manual',signal:AbortSignal.timeout(TIMEOUT_MS)});}catch{return {status:'unknown'};}
 if(r.status===301||r.status===302){const to=r.headers.get('location')??'';return {status:/error=invalid_post|\/post\//.test(to)?'missing':'unknown'};}
 if(r.status===404)return {status:'missing'};
 if(r.status!==200)return {status:'unknown'};
 const html=(await r.text()).slice(0,MAX_BYTES),link=postLink(meta(html,'og:url'));
 return link?{status:'found',author:link.author,code:link.code,text:meta(html,'og:description')??''}:{status:'unknown'};
}
/** Checks up to SPOT_CHECKS rows picked with `random`: {verification:'passed'|'failed'|'unverifiable', checked:[…]}.
 *  One row that is missing or reads differently fails the whole submission; one that cannot be read leaves it unverifiable. */
export async function spotCheck(rows,{fetchImpl,random=Math.random,picks=SPOT_CHECKS}){
 const pool=[...rows],chosen=[];
 while(chosen.length<picks&&pool.length)chosen.push(pool.splice(Math.floor(random()*pool.length),1)[0]);
 const checked=[];
 for(const row of chosen){
  const sent=postLink(row.url),seen=await readPost(row.url,{fetchImpl});
  const result=seen.status!=='found'?seen.status:seen.author!==sent.author||seen.code!==sent.code?'other_post':same(seen.text)!==same(row.text)?'text_differs':'match';
  checked.push({id:row.id,result});
 }
 const results=checked.map(c=>c.result);
 const verification=results.some(r=>r==='missing'||r==='other_post'||r==='text_differs')?'failed':results.length&&results.every(r=>r==='match')?'passed':'unverifiable';
 return {verification,checked};
}
