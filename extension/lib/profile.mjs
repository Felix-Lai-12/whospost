// 帳號背景 (EXTENSION-SPEC §4.4, §10.3 #18–20): for an author on screen, what Threads itself shows the signed-in user in
// its 「關於此個人檔案」 dialog (joined month, the place Threads says the account is based in, how many times the username
// changed), found by the user id that Threads' own name hover card gives. Requested from the content script, same origin,
// with the user's own Threads session; measured 2026-10-24 (extension/docs/profile-lookup.md). Pure: building the two
// requests, reading the answers, and the guard rails (pacing, hourly cap, 7-day cache, the stop after repeated refusals).
// Nothing here is ever sent to Whospost, not even as a count (§10.3 #19), and nothing here feeds a score (#20).
export const HOVERCARD_DOC_ID='29110045098632409',HOVERCARD_NAME='BarcelonaUsernameHovercardImplDirectQuery';
export const ABOUT_APP_ID='com.bloks.www.text_post_app.about_this_profile_async_action';
// The page's own relay variables for the hover card query, as sent on 2026-10-24; without them the answer has no user.
export const HOVERCARD_RELAY=Object.freeze({
 __relay_internal__pv__BarcelonaHasEventBadgerelayprovider:false,
 __relay_internal__pv__BarcelonaHasMessagingrelayprovider:true,
 __relay_internal__pv__BarcelonaIsInternalUserrelayprovider:false,
 __relay_internal__pv__BarcelonaIsLoggedInrelayprovider:true,
 __relay_internal__pv__BarcelonaMessagesHasLiveChatMessagingrelayprovider:false,
 __relay_internal__pv__BarcelonaShouldShowFediverseM1Featuresrelayprovider:true
});
const IG_APP_ID='238260118697367';
// §4.4 rule 1, per account (Felix 10-26): one account every 2 seconds at most, 300 an hour (was 60: lookups start by
// themselves as the user scrolls, and 60 ran out within one long thread). Each account's two reads, hover card then the
// dialog, share one slot. The stop rule below still pauses everything after three refusals in a row.
// Follower and following counts are not shown (Felix 10-24): the hover card's count is read past, the friendships
// dialog is never asked (measured anyway, extension/docs/profile-lookup.md).
export const MIN_GAP_MS=2000,HOURLY_LIMIT=300,HOUR_MS=3600000;
export const CACHE_TTL_MS=7*24*HOUR_MS,CACHE_MAX=2000;
// §4.4 rule 3: three refusals (429/403) or unreadable answers in a row stop the lookups; they come back on their own
// after PAUSE_MS, or when the switch in the popup is turned off and on again.
export const FAIL_STOP=3,PAUSE_MS=6*HOUR_MS;
export const NEW_ACCOUNT_DAYS=60;
// How often the background script reads /api/health for the remote switch (§4.4 rule 3).
export const FLAG_TTL_MS=HOUR_MS;
const USERNAME=/^[a-z0-9_.]{1,30}$/,PK=/^\d{1,25}$/;
export const validUsername=u=>USERNAME.test(String(u??''));

/** The tokens a same-origin request needs, read from the page: fb_dtsg and lsd from the inline scripts, the Bloks
 *  version, the csrftoken cookie. `loggedIn` is the ds_user_id cookie Threads sets for a signed-in user. `ready` is
 *  false when any of them is missing (signed out, or the page changed). */
export function pageTokens(scriptsText,cookie){
 const text=String(scriptsText??''),c=String(cookie??'');
 const cookieOf=name=>c.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))?.[1]??null;
 const dtsg=text.match(/"DTSGInitialData",\[\],\{"token":"([^"]+)"/)?.[1]??null;
 const lsd=text.match(/"LSD",\[\],\{"token":"([^"]+)"/)?.[1]??null;
 const bkv=text.match(/"WebBloksVersioningID",\[\],\{"versioningID":"([0-9a-f]{64})"/)?.[1]??null;
 const csrf=cookieOf('csrftoken'),loggedIn=Boolean(cookieOf('ds_user_id'));
 const ready=Boolean(loggedIn&&dtsg&&lsd&&bkv&&csrf);
 return {loggedIn,ready,dtsg,lsd,bkv,csrf,jazoest:dtsg?`2${[...dtsg].reduce((n,ch)=>n+ch.charCodeAt(0),0)}`:null};
}
const form=(tokens,extra)=>new URLSearchParams({__a:'1',__comet_req:'29',__d:'www',fb_dtsg:tokens.dtsg,jazoest:tokens.jazoest,lsd:tokens.lsd,...extra}).toString();
/** Request 1: the hover card by username → user id, follower count, privacy flag. */
export function hovercardRequest(username,tokens){
 return {url:'/graphql/query',init:{method:'POST',credentials:'include',headers:{'Content-Type':'application/x-www-form-urlencoded','X-FB-LSD':tokens.lsd,'X-CSRFToken':tokens.csrf,'X-IG-App-ID':IG_APP_ID,'X-FB-Friendly-Name':HOVERCARD_NAME},
  body:form(tokens,{fb_api_caller_class:'RelayModern',fb_api_req_friendly_name:HOVERCARD_NAME,server_timestamps:'true',doc_id:HOVERCARD_DOC_ID,variables:JSON.stringify({...HOVERCARD_RELAY,username})})}};
}
/** Request 2: the 「關於此個人檔案」 dialog by user id, asked in Traditional Chinese so the labels are known ones. */
export function aboutRequest(pk,tokens){
 return {url:`/async/wbloks/fetch/?appid=${ABOUT_APP_ID}&type=app&__bkv=${tokens.bkv}&hl=zh-tw`,init:{method:'POST',credentials:'include',headers:{'Content-Type':'application/x-www-form-urlencoded','X-FB-LSD':tokens.lsd},
  body:form(tokens,{params:JSON.stringify({referer_type:'TextPostAppProfileOverflow',target_user_id:String(pk)})})}};
}
export class LookupError extends Error{constructor(code,message=code){super(message);this.code=code;}}
const json=text=>{try{return JSON.parse(String(text).replace(/^for \(;;\);/,''));}catch{return null;}};
const count=v=>Number.isSafeInteger(v)&&v>=0?v:null;
/** The hover card answer: {pk, followers, isPrivate}, or null when Threads has no such account. Throws
 *  LookupError('PARSE') when the answer is not the shape measured on 2026-10-24. */
export function parseHovercard(text,username){
 const body=json(text);
 if(!body||typeof body!=='object'||!('data' in body))throw new LookupError('PARSE','hover card answer unreadable');
 const u=body.data?.user;
 if(u==null)return null;
 if(String(u.username??'').toLowerCase()!==String(username).toLowerCase()||!PK.test(String(u.pk??u.id??'')))throw new LookupError('PARSE','hover card user does not match');
 return {pk:String(u.pk??u.id),followers:count(u.follower_count),isPrivate:typeof u.text_post_app_is_private==='boolean'?u.text_post_app_is_private:null};
}
const strings=(tree,out=[])=>{if(typeof tree==='string')out.push(tree);else if(Array.isArray(tree))for(const v of tree)strings(v,out);else if(tree&&typeof tree==='object')for(const v of Object.values(tree))strings(v,out);return out;};
// The dialog's rows are label, value pairs in document order. Labels in both languages, in case hl=zh-tw is ignored.
const LABELS={joined:['已加入','Joined'],former:['先前的用戶名稱','Former usernames']};
const ROW_SPAN=24,STYLE=/^(-?\d+(\.\d+)?(dp|sp|px|%)?|#[0-9A-Fa-f]{6,8})$/;
const MONTHS=['january','february','march','april','may','june','july','august','september','october','november','december'];
/** "2023年7月 · #1" or "July 2023 · #1" → {year, month, text}; null when it is neither. */
export function parseJoined(value){
 const v=String(value??'').trim();
 let m=v.match(/^(\d{4})\s*年\s*(\d{1,2})\s*月/);
 if(m&&Number(m[2])>=1&&Number(m[2])<=12)return {year:Number(m[1]),month:Number(m[2]),text:v};
 m=v.match(/^([A-Za-z]+)\s+(\d{4})/);const month=m?MONTHS.indexOf(m[1].toLowerCase())+1:0;
 return month?{year:Number(m[2]),month,text:v}:null;
}
/** The dialog answer: {joined:{year,month,text}, country (string or null), countryShared (true/false/null), renames
 *  (a count; 0 when the dialog has no 「先前的用戶名稱」 row; null when the row is there but its number is not)}.
 *  Country comes from the page-state key the dialog fills, not from the visible text. Throws LookupError('PARSE')
 *  when the joined row is missing, which every account measured had. */
export function parseAbout(text){
 const body=json(text),bloks=body?.payload?.layout?.bloks_payload;
 if(!bloks)throw new LookupError('PARSE','about answer unreadable');
 let country=null,countryShared=null;
 for(const d of Array.isArray(bloks.data)?bloks.data:[]){
  const key=String(d?.data?.key??'');
  if(key.endsWith(':about_this_profile_country')&&typeof d.data.initial==='string')country=d.data.initial.trim()||null;
  if(key.endsWith(':about_this_profile_country_visibility')&&typeof d.data.initial==='boolean')countryShared=d.data.initial;
 }
 if(countryShared===false)country=null;
 const all=strings(body.payload).map(s=>s.trim());
 // Between a label and its value the answer carries style values (14sp, colours, weights), so the value is the first
 // string after the label that reads as one, within the row.
 const after=(labels,accept)=>{const i=all.findIndex(s=>labels.includes(s));if(i<0)return undefined;return all.slice(i+1,i+ROW_SPAN).find(accept)??null;};
 const joined=parseJoined(after(LABELS.joined,s=>parseJoined(s)!==null));
 if(!joined)throw new LookupError('PARSE','about answer has no joined row');
 let renames=0;
 const former=after(LABELS.former,s=>/\d/.test(s)&&!STYLE.test(s));
 if(former!==undefined){const n=former?.match(/(\d[\d,]*)/)?.[1];renames=n?Number(n.replace(/,/g,'')):null;}
 return {joined,country,countryShared,renames};
}
/** What a fetch status means for the stop rule: 'ok', 'refused' (429/403), 'error' (anything else). */
export const statusKind=status=>status===200?'ok':status===429||status===403?'refused':'error';

// The local cache: username → {at, data}. Finished lookups only; failures are never cached.
export function cacheGet(cache,username,now=Date.now()){const e=cache?.[username];return e&&Number.isFinite(e.at)&&now-e.at<CACHE_TTL_MS&&now>=e.at&&e.data?e.data:null;}
export function cachePut(cache,username,data,now=Date.now()){
 const fresh=Object.entries(cache&&typeof cache==='object'?cache:{}).filter(([u,e])=>u!==username&&Number.isFinite(e?.at)&&now-e.at<CACHE_TTL_MS).sort((a,b)=>b[1].at-a[1].at).slice(0,CACHE_MAX-1);
 return Object.fromEntries([[username,{at:now,data}],...fresh]);
}
// Pacing: one stamp per request sent. `slot` says whether one more may go now, and when the next may if not.
export const emptyUsage=()=>({stamps:[]});
// The hourly allowance is the clock hour, reset on the hour (Felix 10-27); the 2-second gap still counts across it.
const recent=(usage,now)=>(Array.isArray(usage?.stamps)?usage.stamps:[]).filter(t=>Number.isFinite(t)&&t<=now&&now-t<HOUR_MS);
const hourStart=now=>Math.floor(now/HOUR_MS)*HOUR_MS;
export function slot(usage,now=Date.now()){
 const stamps=recent(usage,now),used=stamps.filter(t=>t>=hourStart(now)).length;
 if(used>=HOURLY_LIMIT)return {allowed:false,reason:'hourly',retryAt:hourStart(now)+HOUR_MS,remaining:0};
 const last=stamps.length?Math.max(...stamps):-Infinity;
 if(now-last<MIN_GAP_MS)return {allowed:false,reason:'gap',retryAt:last+MIN_GAP_MS,remaining:HOURLY_LIMIT-used};
 return {allowed:true,reason:null,retryAt:null,remaining:HOURLY_LIMIT-used};
}
export const recordRequest=(usage,now=Date.now())=>({stamps:[...recent(usage,now),now]});
// The stop rule: consecutive refusals or unreadable answers. A success clears it; other errors (network, 5xx) neither
// count nor clear. Paused until pausedAt + PAUSE_MS.
export const emptyBreaker=()=>({fails:0,pausedAt:null,reason:null});
export function noteOutcome(breaker,kind,now=Date.now()){
 const b={...emptyBreaker(),...(breaker&&typeof breaker==='object'?breaker:{})};
 if(kind==='ok')return emptyBreaker();
 if(kind!=='refused'&&kind!=='parse')return b;
 const fails=b.fails+1;
 return fails>=FAIL_STOP?{fails,pausedAt:now,reason:kind}:{...b,fails};
}
export const paused=(breaker,now=Date.now())=>Number.isFinite(breaker?.pausedAt)&&now>=breaker.pausedAt&&now-breaker.pausedAt<PAUSE_MS;
/** The remote switch from /api/health: {on, checkedAt}. A health answer without the field keeps the lookups on (the
 *  Worker's default); no answer at all keeps the last known value. */
export function flagFromHealth(body,previous,now=Date.now()){
 const v=body?.extension?.profileLookup;
 if(typeof v==='boolean')return {on:v,checkedAt:now};
 if(body&&typeof body==='object')return {on:true,checkedAt:now};
 return {on:previous?.on??true,checkedAt:previous?.checkedAt??null,failedAt:now};
}
export const flagStale=(flag,now=Date.now())=>{const t=Math.max(Number.isFinite(flag?.checkedAt)?flag.checkedAt:0,Number.isFinite(flag?.failedAt)?flag.failedAt:0);return !t||now-t>=FLAG_TTL_MS;};
/** Whether the account joined less than NEW_ACCOUNT_DAYS ago. Only a month is known, so the month's first day is
 *  taken: an account is "new" only when even the earliest day it could have joined is within the window. */
export function isNewAccount(joined,now=Date.now()){
 if(!Number.isInteger(joined?.year)||!Number.isInteger(joined?.month))return false;
 return now-Date.UTC(joined.year,joined.month-1,1)<NEW_ACCOUNT_DAYS*86400000;
}
/** The 新帳號 mark (§4.4 table, last row): new, and either this thread shows the account at or above the chip threshold
 *  or the account is on the list. Described only; it never touches a score or what is folded. */
export const newAccountMark=({data,threadReplies=0,barAt=5,listed=false,now=Date.now()})=>Boolean(data)&&isNewAccount(data.joined,now)&&(threadReplies>=barAt||listed);
