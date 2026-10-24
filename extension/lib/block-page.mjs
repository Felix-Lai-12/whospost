// The profile tab's half of the 封鎖助手 (EXTENSION-SPEC §4.5). A 「封鎖 @xx」 press (the popover's primary button) leaves a hand-over in
// chrome.storage.local and opens /@xx in a new tab; here, on that tab, the hand-over is taken (removed first, so a
// reload never clicks again), lib/block.mjs runs its steps, one bar says how it went, a success goes into the local
// blocked list, and the cooldown restarts from the moment the run ended. A hand-over that is not for this page or is
// older than INTENT_TTL_MS does nothing at all: only a press in this browser, seconds ago, for this account, clicks.
import {intentFor,runBlock,threadsProfileDom,withBlocked,BLOCK_COOLDOWN_MS} from './block.mjs';
import {blockEnabled} from './flags.mjs';
import {blockBarText,BLOCK_NOTE} from './label.mjs';
/** @returns {Promise<null|{ok:boolean,status?:string,step?:string}>} null when this tab was not opened by a press. */
export async function runBlockPage({storage,doc=document,win=window,now=Date.now,dom=threadsProfileDom(doc),run=runBlock}){
 const intent=intentFor(await storage.getBlockIntent(),win.location.pathname,now());
 if(!intent)return null;
 await storage.clearBlockIntent();
 const {username,h}=intent,bar=blockBar(doc);
 // The switch may have been turned off between the press and this tab: nothing is clicked then.
 if(!blockEnabled(await storage.getFlags())){bar.show('off',blockBarText('off'));return {ok:false,step:'off'};}
 bar.show('running',blockBarText('running',{username}));
 let result;
 try{result=await run({username,dom});}catch{result={ok:false,step:'error',reason:'執行時出錯'};}
 await storage.setCooldownUntil(now()+BLOCK_COOLDOWN_MS);
 if(result.ok){
  await storage.setBlocked(withBlocked(await storage.getBlocked(),{h,username},now()));
  bar.show(result.status,blockBarText(result.status,{username}));
 }else bar.show('stopped',blockBarText('stopped',{reason:result.reason}));
 return result;
}
// One bar at the top of the profile tab: the outcome, the fixed line about whose decision this is, and a close button.
function blockBar(doc){
 let bar=null;
 return {show(kind,text){
  if(!bar){
   bar=doc.createElement('div');bar.className='whospost-blockbar';bar.setAttribute('role','status');
   const msg=doc.createElement('span');msg.className='whospost-blockbar-msg';
   const note=doc.createElement('span');note.className='whospost-blockbar-note';note.textContent=BLOCK_NOTE;
   const close=doc.createElement('button');close.type='button';close.className='whospost-blockbar-close';close.textContent='關閉';close.addEventListener('click',()=>bar.remove());
   bar.append(msg,note,close);doc.documentElement.append(bar);
  }
  bar.dataset.whospostBlock=kind;bar.querySelector('.whospost-blockbar-msg').textContent=text;
 }};
}
