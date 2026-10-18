import React,{useEffect,useRef} from 'react';
const SRC='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let loading=null;
const load=()=>loading??=new Promise((resolve,reject)=>{if(window.turnstile)return resolve(window.turnstile);const s=document.createElement('script');s.src=SRC;s.async=true;s.onload=()=>resolve(window.turnstile);s.onerror=()=>{loading=null;reject(Error('turnstile'));};document.head.appendChild(s);});
// Cloudflare Turnstile, shown only when the server sends a site key (the Worker); the local Node server has none.
// A token is single-use, so the widget resets whenever resetKey changes.
export default function Turnstile({siteKey,onToken,resetKey}){
 const box=useRef(null),widget=useRef(null),callback=useRef(onToken);callback.current=onToken;
 useEffect(()=>{
  if(!siteKey)return;let cancelled=false;
  load().then(t=>{if(cancelled||!box.current)return;widget.current=t.render(box.current,{sitekey:siteKey,language:'zh-tw',size:'flexible',callback:token=>callback.current(token),'expired-callback':()=>callback.current(''),'error-callback':()=>callback.current('')});}).catch(()=>callback.current(''));
  return()=>{cancelled=true;if(widget.current!==null&&window.turnstile)window.turnstile.remove(widget.current);widget.current=null;};
 },[siteKey]);
 useEffect(()=>{if(!resetKey)return;callback.current('');if(widget.current!==null&&window.turnstile)window.turnstile.reset(widget.current);},[resetKey]);
 return siteKey?<div className="turnstile" ref={box}/>:null;
}
