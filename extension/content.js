// Content script entry: a classic script that loads the ES-module engine from the extension's own files and wires it
// to chrome.storage and the background script. Nothing here reads cookies, scrolls, or sends anything to Threads.
(async()=>{
 if(window.top!==window)return;
 const url=p=>chrome.runtime.getURL(p);
 let createEngine;
 try{({createEngine}=await import(url('lib/engine.mjs')));}catch(e){console.warn('[whospost] engine failed to load',e);return;}
 const storage={
  getSettings:async()=>(await chrome.storage.sync.get('settings')).settings??null,
  getTrusted:async()=>(await chrome.storage.local.get('trusted')).trusted??{},
  getList:async()=>(await chrome.storage.local.get('list')).list??null,
  setTrusted:trusted=>chrome.storage.local.set({trusted}),
  setPageStats:pageStats=>chrome.storage.local.set({pageStats}),
  onChange(fn){chrome.storage.onChanged.addListener((changes,area)=>{const out={};if(area==='sync'&&changes.settings)out.settings=changes.settings.newValue??null;if(area==='local'&&changes.trusted)out.trusted=changes.trusted.newValue??{};if(area==='local'&&changes.list)out.list=changes.list.newValue??null;if(Object.keys(out).length)fn(out);});}
 };
 const send=message=>new Promise(resolve=>{try{chrome.runtime.sendMessage(message,reply=>{void chrome.runtime.lastError;resolve(reply);});}catch{resolve(undefined);}});
 const runtime={
  ensureList:async()=>(await send({type:'ensureList'}))?.list??null,
  appeal:async h=>(await send({type:'appeal',h}))?.ok===true,
  openPopup:()=>send({type:'openPopup'}),
  // 「回報貢獻」: counts only (lib/report.mjs); the background script drops them when the switch is off.
  tally:delta=>send({type:'tally',delta}),
  domBroken:()=>send({type:'domBroken'})
 };
 const engine=createEngine({storage,runtime});
 await engine.start();
})();
