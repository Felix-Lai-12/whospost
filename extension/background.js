// Service worker: message routing only (§6.5). Downloads the whole hashed list about once an hour with
// If-None-Match, keeps it in chrome.storage.local, and forwards a "Trust" press as one anonymous appeal.
// Every request goes out with credentials omitted and no referrer; nothing identifies the browser but a random
// install id that only ever leaves as a salted hash inside an appeal.
import {LIST_PATH,emptyCache,shouldRefresh,applyFetch,listStatus} from './lib/list.mjs';
import {sha256Hex} from './lib/hash.mjs';
import {mergeSettings} from './lib/settings.mjs';
import {addDelta,markSent,brokenDue,markBroken,brokenPayload,REPORT_PATH} from './lib/report.mjs';
import {addTotals} from './lib/totals.mjs';
import {SCANS_PATH,allowance,recordStart,startOutcome,validUsername,validScanId,emptyUsage,aiFromResponse} from './lib/live.mjs';
import {apiBaseOf} from './lib/settings.mjs';
import {slot,recordRequest,noteOutcome,paused,PAUSE_MS,cachePut,flagFromHealth,flagStale,validUsername as validProfileName} from './lib/profile.mjs';
import {HEALTH_PATH,flagsFromHealth,shouldRefreshFlags} from './lib/flags.mjs';
const FETCH_OPTIONS={credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store'};
// Every request goes to the API base in the settings: the site, or a local Worker while developing.
const readSettings=async()=>mergeSettings((await chrome.storage.sync.get('settings')).settings);
const base=async()=>apiBaseOf(await readSettings());
const VERSION=chrome.runtime.getManifest().version;
let inflight=null;
const readList=async()=>(await chrome.storage.local.get('list')).list??emptyCache();
async function refreshList(force=false){
 if(inflight)return inflight;
 inflight=(async()=>{
  let cache=await readList();
  if(!force&&!shouldRefresh(cache))return cache;
  let outcome;
  try{
   const headers=cache.etag?{'If-None-Match':cache.etag}:{};
   const response=await fetch(`${await base()}${LIST_PATH}`,{...FETCH_OPTIONS,headers});
   outcome=response.status===200?{status:200,body:await response.json(),etag:response.headers.get('ETag')}:{status:response.status};
  }catch(e){outcome={status:0,error:e?.message||'network'};}
  cache=applyFetch(cache,outcome);
  // The fetch succeeded; a failed cache write (quota) must not throw the fresh list away.
  try{await chrome.storage.local.set({list:cache});}catch(e){console.warn('[whospost] list cache write failed',e);}
  return cache;
 })().finally(()=>{inflight=null;});
 return inflight;
}
async function installHash(){
 const saved=await chrome.storage.local.get('installId');
 let id=saved.installId;
 if(!id){id=crypto.randomUUID();await chrome.storage.local.set({installId:id});}
 return sha256Hex(`whospost-appeal:${id}`);
}
async function appeal(h){
 if(!/^[a-f0-9]{64}$/.test(h??''))return {ok:false};
 try{
  const response=await fetch(`${await base()}/api/list/v1/appeal`,{...FETCH_OPTIONS,method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({h,installHash:await installHash()})});
  if(response.ok)refreshList(true).catch(()=>{});
  return {ok:response.ok};
 }catch{return {ok:false};}
}
// 「回報貢獻」(lib/report.mjs): every read-modify-write of the local record runs in turn, so two Threads tabs
// tallying at once cannot lose a count. Off = the record is cleared and nothing is sent.
let reportQueue=Promise.resolve();
const inTurn=fn=>{const run=reportQueue.then(fn,fn);reportQueue=run.catch(()=>{});return run;};
const reportingOn=async()=>(await readSettings()).report;
async function postReport(payload){
 try{const response=await fetch(`${await base()}${REPORT_PATH}`,{...FETCH_OPTIONS,method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});return response.ok;}catch{return false;}
}
/** Adds a page's counts (or nothing: a day-rollover check) to today's tally and posts a finished day when there is one. */
// The popup's dashboard (lib/totals.mjs): running totals kept on this computer, in their own queue so a page's tally
// and a 即時查 answer arriving together cannot lose a count. Counted whether or not reporting is on; never sent.
let totalsQueue=Promise.resolve();
function countTotals(add){
 const run=totalsQueue.then(async()=>{const saved=(await chrome.storage.local.get('totals')).totals;await chrome.storage.local.set({totals:addTotals(saved,add)});});
 totalsQueue=run.catch(()=>{});return totalsQueue;
}
function tally(delta){
 return inTurn(async()=>{
  if(!await reportingOn()){await chrome.storage.local.remove('report');return {ok:false};}
  const saved=(await chrome.storage.local.get('report')).report;
  let {report,send}=addDelta(saved,delta,{version:VERSION});
  if(send&&await postReport(send))report=markSent(report,send);
  if(JSON.stringify(report)!==JSON.stringify(saved))await chrome.storage.local.set({report});
  return {ok:true};
 });
}
/** The health check tripped (§6.3): one dom_broken notice a day, carrying the version only. */
function domBroken(){
 return inTurn(async()=>{
  if(!await reportingOn())return {ok:false};
  const saved=(await chrome.storage.local.get('report')).report;
  if(!brokenDue(saved))return {ok:true,sent:false};
  const sent=await postReport(brokenPayload(VERSION));
  await chrome.storage.local.set({report:markBroken(saved)});
  return {ok:true,sent};
 });
}
// 即時查 (§4.3): one POST /api/scans per press with the account name (the only time a name leaves the browser), at most
// HOURLY_LIMIT new scans an hour per installation (counted here, in chrome.storage.local), then status polls by scan ID.
// No Turnstile token: the site recognises this extension's origin from its whitelist (WHOSPOST_EXTENSION_IDS).
let liveQueue=Promise.resolve();
const liveInTurn=fn=>{const run=liveQueue.then(fn,fn);liveQueue=run.catch(()=>{});return run;};
function liveStart(username){
 return liveInTurn(async()=>{
  if(!validUsername(username))return {ok:false,code:'INVALID_USERNAME',message:'帳號格式不對'};
  const usage=(await chrome.storage.local.get('liveUsage')).liveUsage??emptyUsage(),now=Date.now();
  const a=allowance(usage,now);
  if(!a.allowed)return {ok:false,code:'HOURLY_LIMIT',message:'這小時的即時查用完了',retryAt:a.retryAt};
  let response,body=null;
  try{response=await fetch(`${await base()}${SCANS_PATH}`,{...FETCH_OPTIONS,method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:`https://www.threads.com/@${username.toLowerCase()}`})});try{body=await response.json();}catch{}}
  catch{return startOutcome(0,null);}
  const outcome=startOutcome(response.status,body);
  // Only a scan that actually started counts; a saved result or a refusal costs nothing.
  if(outcome.ok&&response.status===202)await chrome.storage.local.set({liveUsage:recordStart(usage,now)});
  if(outcome.ok)countTotals({queried:1});
  return outcome;
 });
}
async function livePoll(scanId){
 if(!validScanId(scanId))return {ok:false,code:'INVALID_SCAN_ID'};
 try{
  const response=await fetch(`${await base()}${SCANS_PATH}/${scanId}`,FETCH_OPTIONS);
  if(!response.ok)return {ok:false,code:`HTTP_${response.status}`};
  const v=await response.json();
  // Only what the chip needs crosses to the page: status, score, the quick pass, the error, the progress line.
  return {ok:true,view:{id:v.id,status:v.status,score:v.score?{value:v.score.value,assessed:v.score.assessed,unknown:v.score.unknown,items:(v.score.items??[]).map(i=>({id:i.id,status:i.status}))}:null,quick:v.quick??null,completedAt:v.completedAt??null,error:v.error?{code:v.error.code,message:v.error.message}:null,progress:v.progress??''}};
 }catch{return {ok:false,code:'NETWORK'};}
}
// The AI judgement of a finished 即時查 (public, like the result page reads it); only the cut summary crosses to the page.
async function liveAi(scanId){
 if(!validScanId(scanId))return {};
 try{const response=await fetch(`${await base()}${SCANS_PATH}/${scanId}/ai`,FETCH_OPTIONS);return response.ok?aiFromResponse(await response.json()):{};}catch{return {};}
}
// 帳號背景 (EXTENSION-SPEC §4.4, lib/profile.mjs): the content script does the two Threads requests itself (same origin,
// the user's session); this script only hands out the slots (one account 2 s apart, 300 an hour), keeps the stop rule, reads the
// remote switch from /api/health about once an hour, and keeps the 7-day cache. Nothing of it is ever sent to Whospost.
let profileQueue=Promise.resolve();
const profileInTurn=fn=>{const run=profileQueue.then(fn,fn);profileQueue=run.catch(()=>{});return run;};
async function profileFlag(){
 const saved=(await chrome.storage.local.get('profileFlag')).profileFlag;
 if(!flagStale(saved))return saved;
 let body=null;
 try{const response=await fetch(`${await base()}/api/health`,FETCH_OPTIONS);if(response.ok)body=await response.json();}catch{}
 const next=flagFromHealth(body,saved);
 await chrome.storage.local.set({profileFlag:next});
 return next;
}
function profileSlot(){
 return profileInTurn(async()=>{
  if(!(await readSettings()).profileLookup)return {ok:false,reason:'off'};
  if(!(await profileFlag()).on)return {ok:false,reason:'remoteOff'};
  const {profileBreaker,profileUsage}=await chrome.storage.local.get(['profileBreaker','profileUsage']);
  if(paused(profileBreaker))return {ok:false,reason:'paused',retryAt:profileBreaker.pausedAt+PAUSE_MS};
  const s=slot(profileUsage);
  if(!s.allowed)return {ok:false,reason:s.reason,retryAt:s.retryAt};
  await chrome.storage.local.set({profileUsage:recordRequest(profileUsage)});
  return {ok:true,remaining:s.remaining-1};
 });
}
function profileOutcome(kind){
 return profileInTurn(async()=>{
  const saved=(await chrome.storage.local.get('profileBreaker')).profileBreaker;
  const next=noteOutcome(saved,kind);
  if(JSON.stringify(next)!==JSON.stringify(saved??null))await chrome.storage.local.set({profileBreaker:next});
  return {ok:true,paused:paused(next),retryAt:paused(next)?next.pausedAt+PAUSE_MS:null};
 });
}
function profileSave(username,data){
 return profileInTurn(async()=>{
  if(!validProfileName(username)||!data||typeof data!=='object'||!(await readSettings()).profileLookup)return {ok:false};
  const saved=(await chrome.storage.local.get('profiles')).profiles;
  try{await chrome.storage.local.set({profiles:cachePut(saved,username,data)});}catch{return {ok:false};}
  return {ok:true};
 });
}
// Remote switches (lib/flags.mjs): /api/health about once an hour, alongside the list. A failed or switch-less answer
// keeps what was stored, so only an answer from the site turns a feature on or off.
let flagsInflight=null;
function refreshFlags(force=false){
 if(flagsInflight)return flagsInflight;
 flagsInflight=(async()=>{
  const saved=(await chrome.storage.local.get('flags')).flags??null;
  if(!force&&!shouldRefreshFlags(saved))return saved;
  try{
   const response=await fetch(`${await base()}${HEALTH_PATH}`,FETCH_OPTIONS);
   const next=response.ok?flagsFromHealth(await response.json()):null;
   if(next){await chrome.storage.local.set({flags:next});return next;}
  }catch{}
  return saved;
 })().finally(()=>{flagsInflight=null;});
 return flagsInflight;
}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
 if(sender.id!==chrome.runtime.id)return;
 if(message?.type==='profileSlot'){profileSlot().then(reply,()=>reply({ok:false,reason:'off'}));return true;}
 if(message?.type==='profileOutcome'){profileOutcome(message.kind).then(reply,()=>reply({ok:false}));return true;}
 if(message?.type==='profileSave'){profileSave(message.username,message.data).then(reply,()=>reply({ok:false}));return true;}
 if(message?.type==='liveStart'){liveStart(message.username).then(reply,()=>reply({ok:false,code:'NETWORK',message:'連不上 Whospost'}));return true;}
 if(message?.type==='liveAi'){liveAi(message.scanId).then(reply,()=>reply({}));return true;}
 if(message?.type==='livePoll'){livePoll(message.scanId).then(reply,()=>reply({ok:false,code:'NETWORK'}));return true;}
 if(message?.type==='reported'){countTotals({reported:1}).then(()=>reply({ok:true}),()=>reply({ok:false}));return true;}
 if(message?.type==='tally'){tally(message.delta??null).then(reply,()=>reply({ok:false}));return true;}
 if(message?.type==='domBroken'){domBroken().then(reply,()=>reply({ok:false}));return true;}
 if(message?.type==='ensureList'){tally(null).catch(()=>{});refreshFlags().catch(()=>{});refreshList().then(list=>reply({list,status:listStatus(list)}),()=>reply({list:null}));return true;}
 if(message?.type==='refreshList'){refreshFlags(true).catch(()=>{});refreshList(true).then(list=>reply({list,status:listStatus(list)}),()=>reply({list:null}));return true;}
 if(message?.type==='appeal'){appeal(message.h).then(reply,()=>reply({ok:false}));return true;}
 if(message?.type==='openPopup'){Promise.resolve().then(()=>chrome.action.openPopup()).then(()=>reply({ok:true}),()=>reply({ok:false}));return true;}
});
chrome.runtime.onInstalled.addListener(()=>{refreshList(true).catch(()=>{});refreshFlags(true).catch(()=>{});});
chrome.runtime.onStartup.addListener(()=>{refreshList().catch(()=>{});profileFlag().catch(()=>{});refreshFlags().catch(()=>{});});
