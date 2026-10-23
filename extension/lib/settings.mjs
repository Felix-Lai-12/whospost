// User settings (EXTENSION-SPEC-20261022 §3.4, §6.5): kept in chrome.storage.sync under one key with a schemaVersion,
// always written as the whole merged object so a partial write can never drop a field. Pure: no chrome.* here.
export const SCHEMA_VERSION=1;
export const MODES=['label','fade','collapse'];
export const ELECTIONS=['auto','on','off'];
export const DEFAULTS=Object.freeze({
 schemaVersion:SCHEMA_VERSION,
 enabled:true,
 // How a reply that reaches the fade threshold is drawn: 'label' (bar only), 'fade' (bar + dimmed), 'collapse' (bar only, body hidden at collapseAt).
 mode:'fade',
 fadeAt:3,collapseAt:4,
 // §4.1 thread observation: same account ≥ barAt replies draws a bar, ≥ fadeAt dims; the same text from ≥ sameContentAt accounts draws a bar.
 thread:Object.freeze({enabled:true,barAt:5,fadeAt:10,sameContentAt:3}),
 // §10 #5: from 2026-11-18 to 2026-11-28 (Taipei) 'auto' turns the display into 'label' only; 'on'/'off' override that.
 election:'auto',
 // §10 #4: the small grey "check this account on Whospost" icon beside authors that are not on the list.
 showIcon:true
});
export const ELECTION_WINDOW=Object.freeze({from:'2026-11-18',to:'2026-11-28'});
const int=(v,fallback,min,max)=>{const n=Number(v);return Number.isInteger(n)&&n>=min&&n<=max?n:fallback;};
const bool=(v,fallback)=>typeof v==='boolean'?v:fallback;
const oneOf=(v,list,fallback)=>list.includes(v)?v:fallback;
/** The full settings object for whatever was saved: unknown or malformed fields fall back to the defaults, numbers are
 *  clamped, and the result always carries the current schemaVersion. Saving this object back is the only write. */
export function mergeSettings(saved){
 const s=saved&&typeof saved==='object'?saved:{},t=s.thread&&typeof s.thread==='object'?s.thread:{};
 const fadeAt=int(s.fadeAt,DEFAULTS.fadeAt,1,6);
 return {
  schemaVersion:SCHEMA_VERSION,
  enabled:bool(s.enabled,DEFAULTS.enabled),
  mode:oneOf(s.mode,MODES,DEFAULTS.mode),
  fadeAt,
  collapseAt:Math.max(fadeAt,int(s.collapseAt,DEFAULTS.collapseAt,1,6)),
  thread:{
   enabled:bool(t.enabled,DEFAULTS.thread.enabled),
   barAt:int(t.barAt,DEFAULTS.thread.barAt,2,50),
   fadeAt:Math.max(int(t.barAt,DEFAULTS.thread.barAt,2,50),int(t.fadeAt,DEFAULTS.thread.fadeAt,2,100)),
   sameContentAt:int(t.sameContentAt,DEFAULTS.thread.sameContentAt,2,50)
  },
  election:oneOf(s.election,ELECTIONS,DEFAULTS.election),
  showIcon:bool(s.showIcon,DEFAULTS.showIcon)
 };
}
/** The calendar date in Taipei (UTC+8) for a timestamp, as YYYY-MM-DD. */
export const taipeiDate=(now=Date.now())=>new Date(now+8*3600000).toISOString().slice(0,10);
export const inElectionWindow=(now=Date.now())=>{const d=taipeiDate(now);return d>=ELECTION_WINDOW.from&&d<=ELECTION_WINDOW.to;};
/** Whether election mode is in force for these settings right now. */
export const electionActive=(settings,now=Date.now())=>settings.election==='on'||(settings.election==='auto'&&inElectionWindow(now));
/** The display mode to draw with: the user's choice, or 'label' while election mode is in force. */
export const effectiveMode=(settings,now=Date.now())=>electionActive(settings,now)?'label':settings.mode;
