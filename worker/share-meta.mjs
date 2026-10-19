import {reportSummary} from '../shared/share.mjs';
import {signalScore} from '../shared/signals.mjs';
// Link previews (Threads, Instagram, LINE, Facebook) read the og:* tags without running JS, so for a shared
// /?scan=<id> page the Worker writes the account, counts and AI conclusion into index.html before serving it.
// The image is the fixed brand card /og.png; only the text changes per account. Instagram DMs show only the
// title, so the title carries the signal count and the description carries the AI conclusion.
const MAX_LEAD=110;
const clip=text=>text.length>MAX_LEAD?`${text.slice(0,MAX_LEAD-1)}…`:text;
const escapeHtml=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/** Title verdict from the signal score: how many of the checks hit, none, or not enough data. */
export function scoreHeadline(score){
 if(!score||score.value===null||score.value===undefined)return '資料不足';
 return score.value>0?`${score.items?.length??6} 項行為中 ${score.value} 項值得注意`:'未發現可疑行為';
}
/** Preview text for a completed scan, or null. aiConclusion is the shared AI result's conclusion when it is ready. */
export function shareMeta(scan,aiConclusion){
 if(scan?.status!=='completed'||!scan.account?.username)return null;
 const counts=`${scan.posts?.length??0} 篇貼文・${scan.comments?.length??0} 則留言`;
 let lead=typeof aiConclusion==='string'?aiConclusion.trim():'';
 if(!lead){try{lead=reportSummary(scan).title;}catch{lead='查看這個帳號的行為線索';}}
 let score=scan.score;if(!score?.items){try{score=signalScore(scan);}catch{score=null;}}
 return {title:`@${scan.account.username}｜${scoreHeadline(score)}｜Whospost`,description:`${clip(lead)}（${counts}）`};
}

/** Rewrites the title and the description, og:* and twitter:* tags that index.html already carries. */
export function withShareMeta(html,{title,description,url,image}){
 const set=(attr,name,value)=>{if(value!=null)html=html.replace(new RegExp(`(<meta ${attr}="${name}" content=")[^"]*(")`),(_,open,close)=>open+escapeHtml(value)+close);};
 if(title!=null)html=html.replace(/<title>[^<]*<\/title>/,()=>`<title>${escapeHtml(title)}</title>`);
 for(const [attr,name,value] of [['name','description',description],['property','og:title',title],['property','og:description',description],['property','og:url',url],['property','og:image',image],['name','twitter:title',title],['name','twitter:description',description],['name','twitter:image',image]])set(attr,name,value);
 return html;
}
