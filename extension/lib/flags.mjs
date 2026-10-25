// Remote switches from the site (/api/health → extension, worker/extension-flags.mjs), kept in chrome.storage.local
// under 'flags' and refreshed about once an hour by the background script. Pure: no chrome.* here.
// A switch is on only when the site said so: never fetched, or an answer without it, means off (a feature the site
// cannot stop stays hidden). A failed refresh keeps the last answer, so a network blip neither hides nor shows anything.
export const HEALTH_PATH='/api/health';
export const FLAGS_TTL_MS=60*60*1000;
// 封鎖助手 ships from 0.2.0. The 0.1.0 store submission leaves it out (store/listing.*.md, store/privacy-form.md §8):
// below this version the site's switch is ignored, the popup hides 已封鎖, and scripts/pack-extension.mjs drops the
// profile-tab runner (lib/block-page.mjs), so nothing in that package ever presses a Threads button.
export const BLOCK_SINCE='0.2.0';
const parts=v=>String(v??'').split('.').map(n=>Number.parseInt(n,10));
/** Whether this manifest version carries 封鎖助手: numeric dotted compare against BLOCK_SINCE; unreadable means no. */
export function blockShipped(version){
 const a=parts(version),b=parts(BLOCK_SINCE);
 if(!a.length||a.some(n=>!Number.isFinite(n)))return false;
 for(let i=0;i<b.length;i++){const x=a[i]??0;if(x!==b[i])return x>b[i];}
 return true;
}
/** The flags record for a /api/health body, or null when the body carries no extension switches. block stays false
 *  in a version without 封鎖助手 whatever the site says. */
export function flagsFromHealth(body,now=Date.now(),version=BLOCK_SINCE){
 const e=body?.extension;
 if(!e||typeof e!=='object')return null;
 return {block:e.block===true&&blockShipped(version),fetchedAt:now};
}
export const shouldRefreshFlags=(flags,now=Date.now())=>!Number.isFinite(flags?.fetchedAt)||now-flags.fetchedAt>=FLAGS_TTL_MS;
/** 封鎖助手 (EXTENSION-SPEC §4.5): shown only while the site's switch is known to be on. */
export const blockEnabled=flags=>flags?.block===true;
