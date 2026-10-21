import React, {useEffect, useRef, useState} from 'react';
import {voteConfig,countdownView,countdownText,countdownAria} from './countdown-model.mjs';
import {readPledge,submitPledge,formatCount} from './pledge-model.mjs';
import {analytics} from './analytics.mjs';
// Header strip: the election-day countdown (device clock, ticks once a second, pauses in a hidden tab) and the
// "我會去投票" pledge button. Outside <nav> on purpose: the pledge is a <button>, not a site link, so it sends no navigation event.
// Wording stays on voting itself: no candidate, party, number or colour anywhere in this file.
const CONFIG=voteConfig(import.meta.env??{});
const storage=(()=>{try{return globalThis.localStorage}catch{return null}})();
function useCountdown(){
 const [view,setView]=useState(()=>countdownView(Date.now(),CONFIG));
 useEffect(()=>{
  if(view.phase==='hidden')return;
  let timer=null;
  const tick=()=>setView(countdownView(Date.now(),CONFIG));
  const start=()=>{if(timer===null){tick();timer=setInterval(tick,1000);}};
  const stop=()=>{if(timer!==null){clearInterval(timer);timer=null;}};
  const onVisibility=()=>{document.visibilityState==='hidden'?stop():start();};
  onVisibility();document.addEventListener('visibilitychange',onVisibility);
  return()=>{stop();document.removeEventListener('visibilitychange',onVisibility);};
 },[view.phase]);
 return view;
}
export default function VoteStrip(){
 const view=useCountdown();
 const [pledged,setPledged]=useState(()=>readPledge(storage)?.counted===true);
 const [count,setCount]=useState(null);
 const [busy,setBusy]=useState(false);
 const [toast,setToast]=useState(null);
 const alive=useRef(true);
 useEffect(()=>{alive.current=true;if(view.phase==='hidden')return;fetch('/api/pledge').then(r=>r.ok?r.json():null).then(d=>{if(alive.current&&Number.isFinite(d?.count))setCount(d.count);}).catch(()=>{});return()=>{alive.current=false;};},[view.phase]);
 if(view.phase==='hidden')return null;
 const text=countdownText(view),aria=countdownAria(view);
 async function pledge(){
  if(busy||pledged)return;
  setBusy(true);
  const outcome=await submitPledge({storage,analytics});
  if(!alive.current)return;
  setBusy(false);
  if(outcome.count!==null)setCount(outcome.count);
  if(outcome.status==='counted'||outcome.status==='already'){setPledged(true);setToast({id:Date.now(),text:'已登記'});}
  else setToast({id:Date.now(),text:outcome.status==='rate_limited'?'按太快了，一分鐘後再試':'暫時送不出去，稍後再試'});
 }
 const showButton=view.phase!=='closed';
 const people=count!==null&&count>0?formatCount(count):null;
 return <section className="vote-strip" aria-label="投票倒數">
  <div className="vote-countdown" role="timer" aria-label={aria}>
   <span className="vote-countdown-label">{text.label}{text.value===null&&people&&<>，謝謝 {people} 位說會去投票的人</>}</span>
   {text.value!==null&&<span className="vote-countdown-value">{text.value}</span>}
  </div>
  {showButton&&(pledged?<p className="vote-done" role="status">{people?<><strong>{people}</strong> 人準備去投票</>:'已登記，謝謝你'}</p>:<div className="vote-pledge">
   <button type="button" className="header-button vote-button" onClick={pledge} disabled={busy}>{busy?'登記中…':<>我會去投票<span aria-hidden="true"> →</span></>}</button>
   {people&&<span className="vote-count">已有 {people} 人</span>}
  </div>)}
  <div className="toast-region" role="status" aria-live="polite">{toast&&<div key={toast.id} className="toast">{toast.text}</div>}</div>
 </section>;
}
