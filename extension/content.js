// Content script entry: a classic script that loads the ES-module engine from the extension's own files and wires it
// to chrome.storage and the background script. Nothing here scrolls; the only requests to Threads are 帳號背景's two
// reads per on-screen author (lib/profile-runner.mjs), sent with the user's own session and kept on this computer (only an 「AI 打詐」 account's place and joined month go to
// Whospost, Felix 10-27); the
// only Threads buttons it ever presses are a reply's own 「⋯ → 封鎖 → 確認」 and 「⋯ → 檢舉」, each after a press in the popover.
(async()=>{
 if(window.top!==window)return;
 const url=p=>chrome.runtime.getURL(p);
 let createEngine;
 try{({createEngine}=await import(url('lib/engine.mjs')));}catch(e){console.warn('[whospost] engine failed to load',e);return;}
 const storage={
  getSettings:async()=>(await chrome.storage.sync.get('settings')).settings??null,
  getTrusted:async()=>(await chrome.storage.local.get('trusted')).trusted??{},
  getList:async()=>(await chrome.storage.local.get('list')).list??null,
  getLive:async()=>(await chrome.storage.local.get('live')).live??null,
  getProfiles:async()=>(await chrome.storage.local.get('profiles')).profiles??{},
  setLive:live=>chrome.storage.local.set({live}),
  setTrusted:trusted=>chrome.storage.local.set({trusted}),
  setPageStats:pageStats=>chrome.storage.local.set({pageStats}),
  onChange(fn){chrome.storage.onChanged.addListener((changes,area)=>{const out={};if(area==='sync'&&changes.settings)out.settings=changes.settings.newValue??null;if(area==='local'&&changes.trusted)out.trusted=changes.trusted.newValue??{};if(area==='local'&&changes.list)out.list=changes.list.newValue??null;if(area==='local'&&changes.live)out.live=changes.live.newValue??null;if(area==='local'&&changes.profiles)out.profiles=changes.profiles.newValue??{};if(area==='local'&&(changes.profileFlag||changes.profileBreaker))out.profileSwitch=true;if(Object.keys(out).length)fn(out);});}
 };
 const send=message=>new Promise(resolve=>{try{chrome.runtime.sendMessage(message,reply=>{void chrome.runtime.lastError;resolve(reply);});}catch{resolve(undefined);}});
 const runtime={
  ensureList:async()=>(await send({type:'ensureList'}))?.list??null,
  appeal:async h=>(await send({type:'appeal',h}))?.ok===true,
  openPopup:()=>send({type:'openPopup'}),
  // 「回報貢獻」: counts only (lib/report.mjs); the background script drops them when the switch is off.
  tally:delta=>send({type:'tally',delta}),
  domBroken:()=>send({type:'domBroken'}),
  // AI 打詐 (§4.3): an account name leaves the browser only on the user's press (AI 打詐, or 查詢背景 once it is used up).
  liveStart:username=>send({type:'liveStart',username}),
  livePoll:scanId=>send({type:'livePoll',scanId}),
  liveAi:scanId=>send({type:'liveAi',scanId}),
  liveAllowance:()=>send({type:'liveAllowance'}),
  // 查詢背景 with 「AI 打詐」 used up: a result the site already has, nothing new started (Felix 10-27).
  liveSaved:username=>send({type:'liveSaved',username}),
  // The place and joined month of an 「AI 打詐」 account, for the list (lib/profile.mjs reportBody).
  profileReport:(scanId,body)=>send({type:'profileReport',scanId,body}),
  // 查詢背景 on the popup's dashboard: one count per press of the 查詢背景 control (Felix 10-27).
  backgroundPressed:()=>send({type:'backgroundPressed'}),
  // A block that went through, for the daily anonymous count (Felix 10-27); the blocked list itself stays local.
  blockedOne:()=>send({type:'blockedOne'}),
  // 帳號背景 (§4.4): the background script paces and switches; the two Threads requests go from here, same origin.
  profileSlot:()=>send({type:'profileSlot'}),
  profileOutcome:kind=>send({type:'profileOutcome',kind}),
  profileSave:(username,data)=>send({type:'profileSave',username,data}),
  // Replies read after 「AI 打詐」 (0.2.0, lib/replies.mjs): the gate (switches, the one-time notice), the one POST with
  // the rows by scan id, the daily counts, and the notice's 「關閉」. The Threads requests go from here, same origin.
  repliesGate:()=>send({type:'repliesGate'}),
  repliesSubmit:(scanId,rows)=>send({type:'repliesSubmit',scanId,rows}),
  repliesOutcome:code=>send({type:'repliesOutcome',code}),
  repliesOff:()=>send({type:'repliesOff'})
 };
 // 封鎖助手 (EXTENSION-SPEC §4.5): the local blocked list, the site's switch and the cooldown shared by every tab. All in
 // chrome.storage.local; none of it is ever sent.
 const local=async key=>(await chrome.storage.local.get(key))[key];
 Object.assign(storage,{
  getBlockState:async()=>{const r=await chrome.storage.local.get(['blocked','flags','blockCooldownUntil']);return {blocked:r.blocked??{},flags:r.flags??null,cooldownUntil:r.blockCooldownUntil??0};},
  getBlocked:async()=>(await local('blocked'))??{},
  setBlocked:blocked=>chrome.storage.local.set({blocked}),
  getFlags:async()=>(await local('flags'))??null,
  setCooldownUntil:blockCooldownUntil=>chrome.storage.local.set({blockCooldownUntil}),
  onBlockChange(fn){chrome.storage.onChanged.addListener((changes,area)=>{if(area!=='local')return;const out={};if(changes.blocked)out.blocked=changes.blocked.newValue??{};if(changes.flags)out.flags=changes.flags.newValue??null;if(changes.blockCooldownUntil)out.cooldownUntil=changes.blockCooldownUntil.newValue??0;if(Object.keys(out).length)fn(out);});}
 });
 // After the extension is reloaded or updated, this copy keeps running in tabs opened before it, and every chrome.*
 // call throws 「Extension context invalidated」. Answer as if nothing were stored instead; reloading the tab brings
 // the new copy in.
 const alive=()=>{try{return !!chrome.runtime?.id;}catch{return false;}};
 const DEAD={getSettings:null,getTrusted:{},getList:null,getLive:null,getProfiles:{},getBlockState:{blocked:{},flags:null,cooldownUntil:0},getBlocked:{},getFlags:null};
 for(const [k,fn] of Object.entries(storage))storage[k]=(...a)=>{
  const fallback=DEAD[k];
  if(!alive())return k.startsWith('on')?undefined:Promise.resolve(fallback);
  try{const r=fn(...a);return r&&typeof r.then==='function'?r.catch(()=>fallback):r;}catch{return k.startsWith('on')?undefined:Promise.resolve(fallback);}
 };
 const engine=createEngine({storage,runtime});
 await engine.start();
})();
