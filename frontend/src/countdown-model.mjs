// Election-day countdown, pure functions so node:test can drive them. The clock is the visitor's device; no API.
// Default target: 2026-11-28 08:00 Taipei (polls open), which is exactly 2026-11-28T00:00:00Z, so no zone maths.
// Build-time overrides for forks: VITE_VOTE_OPEN_AT (ISO date-time with zone) and VITE_VOTE_COUNTDOWN=0 (off).
export const DEFAULT_VOTE_OPEN_MS=Date.UTC(2026,10,28,0,0,0);
const HOUR=3600000;
export const VOTE_DAY_LABEL='11/28';
/** Resolve the build config: {enabled, openMs, closeMs, hideMs}. openMs is polls open; close is +8 h; hide is Taipei midnight after. */
export function voteConfig(env={}){
 if(String(env.VITE_VOTE_COUNTDOWN??'').trim()==='0')return {enabled:false,openMs:DEFAULT_VOTE_OPEN_MS,closeMs:DEFAULT_VOTE_OPEN_MS+8*HOUR,hideMs:DEFAULT_VOTE_OPEN_MS+16*HOUR};
 let openMs=DEFAULT_VOTE_OPEN_MS;
 const raw=typeof env.VITE_VOTE_OPEN_AT==='string'?env.VITE_VOTE_OPEN_AT.trim():'';
 if(raw){const t=Date.parse(raw);if(Number.isFinite(t))openMs=t;}
 return {enabled:true,openMs,closeMs:openMs+8*HOUR,hideMs:openMs+16*HOUR};
}
const two=n=>String(n).padStart(2,'0');
/**
 * What to show at `nowMs`: phase before (counting down; `today` once it is election day in Taipei, i.e. within
 * 8 h of polls opening) / open (08:00–16:00) / closed (until midnight) / hidden (gone for good).
 */
export function countdownView(nowMs,config=voteConfig()){
 const {enabled,openMs,closeMs,hideMs}=config;
 if(!enabled||nowMs>=hideMs)return {phase:'hidden'};
 if(nowMs>=closeMs)return {phase:'closed'};
 if(nowMs>=openMs)return {phase:'open'};
 const left=openMs-nowMs,days=Math.floor(left/(24*HOUR)),rest=left-days*24*HOUR;
 const hours=Math.floor(rest/HOUR),minutes=Math.floor((rest%HOUR)/60000),seconds=Math.floor((rest%60000)/1000);
 return {phase:'before',today:left<=8*HOUR,days,hours,minutes,seconds,clock:`${two(hours)}:${two(minutes)}:${two(seconds)}`};
}
/** Copy for the countdown sticker: {label, value} (value null when there is no number to show). */
export function countdownText(view){
 if(view.phase==='before')return view.today?{label:'今天投票日',value:`${view.clock} 後開門`}:{label:`${VOTE_DAY_LABEL} 投票日還有`,value:`${view.days} 天 ${view.clock}`};
 if(view.phase==='open')return {label:'今天投票日',value:'投票所開到 16:00'};
 if(view.phase==='closed')return {label:'投票結束',value:null};
 return {label:'',value:null};
}
/** Screen-reader label, refreshed once a minute by the component (never aria-live per second). */
export function countdownAria(view){
 if(view.phase==='before')return view.today?`今天投票日，${view.hours} 小時 ${view.minutes} 分後投票所開門`:`距 11 月 28 日投票日還有 ${view.days} 天 ${view.hours} 小時 ${view.minutes} 分`;
 if(view.phase==='open')return '今天投票日，投票所開到 16:00';
 if(view.phase==='closed')return '投票結束';
 return '';
}
