// Self-hosted sponsor slots, configured at build time through VITE_SPONSOR_SLOTS (a JSON array).
// Unset or blank: the built-in default below (the project's own fundraising card). Set to [] to show nothing.
// Malformed JSON or entries that fail validation are dropped, never rendered as a blank block.
// Images come from this origin only (frontend/public/sponsor/) and no third-party script is ever loaded.
export const SPONSOR_SLOTS=['result_bottom','waiting'];
/** The project's own fundraising card: a text card in the search-bar format, same link and copy as the out-of-quota appeal in main.jsx. */
export const DEFAULT_SPONSOR_SLOTS=SPONSOR_SLOTS.map(slot=>({slot,campaign:'fundraising',text:'每次查詢都要付資料抓取費，邀請你小額捐款 100 元，讓 Whospost 跑到大選截止。',cta:'為民主充值',href:'https://whospost.bobaboba.me'}));
const CAMPAIGN=/^[a-z0-9_-]{1,32}$/,IMAGE=/^\/(?!\/)[A-Za-z0-9_\-./]{1,200}$/,MAX_ALT=120,MAX_TEXT=200,MAX_CTA=24;
const safeHref=value=>{try{const u=new URL(value);return u.protocol==='https:'?u.href:null}catch{return null}};
// Two shapes: an image banner ({image, alt}) or a text card ({text, cta}) laid out like the search bar.
function normalize(entry){
 if(!entry||typeof entry!=='object')return null;
 const {slot,campaign,image,href,alt,text,cta}=entry;
 if(!SPONSOR_SLOTS.includes(slot))return null;
 if(typeof campaign!=='string'||!CAMPAIGN.test(campaign))return null;
 const link=typeof href==='string'?safeHref(href):null;if(!link)return null;
 if(typeof image==='string'){
  if(!IMAGE.test(image)||image.includes('..'))return null;
  if(typeof alt!=='string'||!alt.trim()||alt.length>MAX_ALT)return null;
  return {slot,campaign,kind:'image',image,href:link,alt:alt.trim()};
 }
 if(typeof text!=='string'||!text.trim()||text.length>MAX_TEXT)return null;
 if(typeof cta!=='string'||!cta.trim()||cta.length>MAX_CTA)return null;
 return {slot,campaign,kind:'text',text:text.trim(),cta:cta.trim(),href:link};
}
/** Parse VITE_SPONSOR_SLOTS. Unset → built-in default; otherwise invalid entries are dropped and the first entry per slot wins. */
export function parseSponsorSlots(raw){
 if(typeof raw!=='string'||!raw.trim())return DEFAULT_SPONSOR_SLOTS.map(normalize).filter(Boolean);
 let list;try{list=JSON.parse(raw)}catch{return []}
 if(!Array.isArray(list))return [];
 const out=[];for(const entry of list){const slot=normalize(entry);if(slot&&!out.some(s=>s.slot===slot.slot))out.push(slot);}
 return out;
}
export const sponsorFor=(slots,name)=>slots.find(s=>s.slot===name)??null;
/** GA params for a slot: only the slot name and campaign label, never the visitor or the scanned account. */
export const sponsorParams=({slot,campaign})=>({slot,campaign});
/** Click handler: sends ad_click for click and middle-click before the new tab opens. */
export function sponsorClickTracking(analytics,sponsor){
 const send=e=>{if(e?.type==='auxclick'&&e.button!==1)return;analytics.track('ad_click',sponsorParams(sponsor))};
 return {onClick:send,onAuxClick:send};
}
/** ad_impression: once per browser session per slot, sent when the slot is first in view. */
export function sponsorImpression(analytics,sponsor){analytics.trackOnce(`ad:${sponsor.slot}`,'ad_impression',sponsorParams(sponsor));}
