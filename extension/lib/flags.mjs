// Remote switches from the site (/api/health → extension, worker/extension-flags.mjs), kept in chrome.storage.local
// under 'flags' and refreshed about once an hour by the background script. Pure: no chrome.* here.
// A switch is on only when the site said so: never fetched, or an answer without it, means off (a feature the site
// cannot stop stays hidden). A failed refresh keeps the last answer, so a network blip neither hides nor shows anything.
export const HEALTH_PATH='/api/health';
export const FLAGS_TTL_MS=60*60*1000;
/** The flags record for a /api/health body, or null when the body carries no extension switches. */
export function flagsFromHealth(body,now=Date.now()){
 const e=body?.extension;
 if(!e||typeof e!=='object')return null;
 return {block:e.block===true,fetchedAt:now};
}
export const shouldRefreshFlags=(flags,now=Date.now())=>!Number.isFinite(flags?.fetchedAt)||now-flags.fetchedAt>=FLAGS_TTL_MS;
/** 封鎖助手 (EXTENSION-SPEC §4.5): shown only while the site's switch is known to be on. */
export const blockEnabled=flags=>flags?.block===true;
