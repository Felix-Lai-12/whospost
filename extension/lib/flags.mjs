// Remote switches from the site (/api/health → extension, worker/extension-flags.mjs), kept in chrome.storage.local
// under 'flags' and refreshed about once an hour by the background script. Pure: no chrome.* here.
// A switch is on only when the site said so: never fetched, or an answer without it, means off (a feature the site
// cannot stop stays hidden). A failed refresh keeps the last answer, so a network blip neither hides nor shows anything.
export const HEALTH_PATH='/api/health';
export const FLAGS_TTL_MS=60*60*1000;
/** The flags record for a /api/health body, or null when the body carries no extension switches. */
// replies (plan-extension-replies 2026-10-29, 0.2.0): reading an 「AI 打詐」 account's replies with the user's own session
// and sending them to the site (lib/replies.mjs); repliesQuery is the data the read needs — Threads' current query id
// and the page size — which the site changes without a release (the store forbids remote code; this is not code).
const DOC=/^\d{10,25}$/;
export function flagsFromHealth(body,now=Date.now()){
 const e=body?.extension;
 if(!e||typeof e!=='object')return null;
 const q=e.repliesQuery&&typeof e.repliesQuery==='object'?e.repliesQuery:{};
 const repliesQuery={docId:DOC.test(String(q.docId??''))?String(q.docId):null,first:Number.isInteger(q.first)&&q.first>=6&&q.first<=30?q.first:null};
 return {block:e.block===true,replies:e.replies===true,repliesQuery,fetchedAt:now};
}
export const shouldRefreshFlags=(flags,now=Date.now())=>!Number.isFinite(flags?.fetchedAt)||now-flags.fetchedAt>=FLAGS_TTL_MS;
/** 封鎖助手 (EXTENSION-SPEC §4.5): shown only while the site's switch is known to be on. */
export const blockEnabled=flags=>flags?.block===true;
/** Reading replies after 「AI 打詐」 (lib/replies.mjs): only while the site's switch is known to be on. */
export const repliesEnabled=flags=>flags?.replies===true;
