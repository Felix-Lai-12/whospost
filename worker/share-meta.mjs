import {reportSummary} from '../shared/share.mjs';
import {signalScore,withAiItems} from '../shared/signals.mjs';
// Link previews (Threads, Instagram, LINE, Facebook) read the og:* tags without running JS, so for a shared
// /?scan=<id> page the Worker writes the account, counts and AI conclusion into index.html before serving it.
// The image is a per-account card rendered by the OG image Durable Object (og-card.mjs), with the brand card
// /og.png as fallback. Instagram DMs show only the title, so the title carries the signal count and the
// description carries the AI conclusion.
const MAX_LEAD=110;
const clip=text=>text.length>MAX_LEAD?`${text.slice(0,MAX_LEAD-1)}…`:text;
const escapeHtml=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/** Title verdict from the signal score: how many of the checks hit, none, or not enough data. With nothing hit while
 *  the AI item is still being written, it says so instead of 未發現 (not knowing is not nothing found). */
export function scoreHeadline(score){
 if(!score||score.value===null||score.value===undefined)return score?.pending?'AI 判讀中':'資料不足';
 // 「N 項中」, not 「N 項行為中」: item 8 (signals-v3) is about content, not behaviour.
 return score.value>0?`${score.items?.length??6} 項中 ${score.value} 項值得注意`:score.pending?'AI 判讀中':'未發現可疑跡象';
}
/** Card data for a completed scan, or null: the account, the verdict and the lead line (AI conclusion when
 *  ready, else the signal summary). Shared by the preview text and the preview image so both say the same.
 *  verdicts ({behavior, content}: shared/signals.mjs aiVerdict, contentVerdict) are items 7 and 8; the headline counts
 *  all eight (signals-v3). */
export function shareCard(scan,aiConclusion,verdicts={}){
 if(scan?.status!=='completed'||!scan.account?.username)return null;
 let lead=typeof aiConclusion==='string'?aiConclusion.trim():'';
 if(!lead){try{lead=reportSummary(scan).title;}catch{lead='查看這個帳號的行為線索';}}
 let score=scan.score;if(!score?.items){try{score=signalScore(scan);}catch{score=null;}}
 score=score&&withAiItems(score,verdicts);
 const hits=score?.value??null;
 return {username:scan.account.username,headline:scoreHeadline(score),tone:hits===null?'unknown':hits>0?'hit':score.pending?'unknown':'clear',lead,
  counts:`${scan.posts?.length??0} 篇貼文・${scan.comments?.length??0} 則留言`};
}
/** Preview text for a completed scan, or null. aiConclusion is the shared AI result's conclusion when it is ready. */
export function shareMeta(scan,aiConclusion,verdicts={}){
 const card=shareCard(scan,aiConclusion,verdicts);if(!card)return null;
 return {title:`@${card.username}｜${card.headline}｜Whospost`,description:`${clip(card.lead)}（${card.counts}）`};
}

/** Rewrites the title and the description, og:* and twitter:* tags that index.html already carries. */
export function withShareMeta(html,{title,description,url,image}){
 const set=(attr,name,value)=>{if(value!=null)html=html.replace(new RegExp(`(<meta ${attr}="${name}" content=")[^"]*(")`),(_,open,close)=>open+escapeHtml(value)+close);};
 if(title!=null)html=html.replace(/<title>[^<]*<\/title>/,()=>`<title>${escapeHtml(title)}</title>`);
 for(const [attr,name,value] of [['name','description',description],['property','og:title',title],['property','og:description',description],['property','og:url',url],['property','og:image',image],['name','twitter:title',title],['name','twitter:description',description],['name','twitter:image',image]])set(attr,name,value);
 return html;
}
