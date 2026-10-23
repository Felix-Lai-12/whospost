// Service worker: message routing only (§6.5). Downloads the whole hashed list about once an hour with
// If-None-Match, keeps it in chrome.storage.local, and forwards a "Trust" press as one anonymous appeal.
// Every request goes out with credentials omitted and no referrer; nothing identifies the browser but a random
// install id that only ever leaves as a salted hash inside an appeal.
import {LIST_PATH,emptyCache,shouldRefresh,applyFetch,listStatus} from './lib/list.mjs';
import {sha256Hex} from './lib/hash.mjs';
const SITE='https://whospost.felixlai.workers.dev';
const FETCH_OPTIONS={credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store'};
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
   const response=await fetch(`${SITE}${LIST_PATH}`,{...FETCH_OPTIONS,headers});
   outcome=response.status===200?{status:200,body:await response.json(),etag:response.headers.get('ETag')}:{status:response.status};
  }catch(e){outcome={status:0,error:e?.message||'network'};}
  cache=applyFetch(cache,outcome);
  await chrome.storage.local.set({list:cache});
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
  const response=await fetch(`${SITE}/api/list/v1/appeal`,{...FETCH_OPTIONS,method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({h,installHash:await installHash()})});
  if(response.ok)refreshList(true).catch(()=>{});
  return {ok:response.ok};
 }catch{return {ok:false};}
}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
 if(sender.id!==chrome.runtime.id)return;
 if(message?.type==='ensureList'){refreshList().then(list=>reply({list,status:listStatus(list)}),()=>reply({list:null}));return true;}
 if(message?.type==='refreshList'){refreshList(true).then(list=>reply({list,status:listStatus(list)}),()=>reply({list:null}));return true;}
 if(message?.type==='appeal'){appeal(message.h).then(reply,()=>reply({ok:false}));return true;}
 if(message?.type==='openPopup'){Promise.resolve().then(()=>chrome.action.openPopup()).then(()=>reply({ok:true}),()=>reply({ok:false}));return true;}
});
chrome.runtime.onInstalled.addListener(()=>{refreshList(true).catch(()=>{});});
chrome.runtime.onStartup.addListener(()=>{refreshList().catch(()=>{});});
