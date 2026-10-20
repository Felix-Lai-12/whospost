// Self-hosted sponsor slots. Configured at build time through VITE_SPONSOR_SLOTS (a JSON array); when it is
// missing, malformed or holds no valid entry nothing renders, so a fork without the variable shows no ad.
// Images come from this origin only (frontend/public/sponsor/) and no third-party script is ever loaded.
export const SPONSOR_SLOTS=['result_bottom','waiting'];
const CAMPAIGN=/^[a-z0-9_-]{1,32}$/,IMAGE=/^\/(?!\/)[A-Za-z0-9_\-./]{1,200}$/,MAX_ALT=120;
const safeHref=value=>{try{const u=new URL(value);return u.protocol==='https:'?u.href:null}catch{return null}};
function normalize(entry){
 if(!entry||typeof entry!=='object')return null;
 const {slot,campaign,image,href,alt}=entry;
 if(!SPONSOR_SLOTS.includes(slot))return null;
 if(typeof campaign!=='string'||!CAMPAIGN.test(campaign))return null;
 if(typeof image!=='string'||!IMAGE.test(image)||image.includes('..'))return null;
 const link=typeof href==='string'?safeHref(href):null;if(!link)return null;
 if(typeof alt!=='string'||!alt.trim()||alt.length>MAX_ALT)return null;
 return {slot,campaign,image,href:link,alt:alt.trim()};
}
/** Parse VITE_SPONSOR_SLOTS. Always returns an array; invalid entries are dropped, the first entry per slot wins. */
export function parseSponsorSlots(raw){
 if(typeof raw!=='string'||!raw.trim())return [];
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
