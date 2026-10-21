import React,{useEffect,useRef,useState} from 'react';
import {resultShareUrl,resultShareText} from '../../shared/share.mjs';
import {signalScore} from '../../shared/signals.mjs';
import {analytics} from './analytics.mjs';
import {avatarUrl,avatarFileName,avatarState,downloadAvatar} from './avatar-download.mjs';
const AVATAR_TOAST={share:'已交給分享面板，選「儲存影像」就能存成頭貼',download:'已下載頭貼圖',open:'已開啟頭貼圖，長按圖片可儲存'};
export default function ShareResult({scan}){
 const [notice,setNotice]=useState('');
 const [toast,setToast]=useState({n:0,text:''});
 const [busy,setBusy]=useState(false);
 const [avatarLink,setAvatarLink]=useState('');
 const timer=useRef();
 useEffect(()=>()=>clearTimeout(timer.current),[]);
 const text=resultShareText(resultShareUrl(location.origin,location.pathname,scan.id));
 function showToast(message){setNotice('');setAvatarLink('');clearTimeout(timer.current);setToast(t=>({n:t.n+1,text:message}));timer.current=setTimeout(()=>setToast({n:0,text:''}),2600)}
 // Clipboard API can be blocked by permissions; fall back to a temporary textarea copy.
 function legacyCopy(){const area=document.createElement('textarea');area.value=text;area.setAttribute('readonly','');area.style.position='fixed';area.style.opacity='0';document.body.appendChild(area);area.select();let ok=false;try{ok=document.execCommand('copy')}catch{}area.remove();return ok}
 async function copy(){let ok=false;try{await navigator.clipboard.writeText(text);ok=true}catch{ok=legacyCopy()}analytics.track('share_copy',{result:ok?'success':'fail'});if(ok)showToast('已複製分享文字');else setNotice(`無法自動複製，請手動複製：${text}`)}
 // The 1080×1080 card is drawn once by the Worker; the first request can take a second or two.
 async function download(){
  if(busy)return;setBusy(true);
  const state=avatarState(signalScore(scan));
  try{
   const {result,method,openUrl}=await downloadAvatar({url:avatarUrl(location.origin,scan.id),fileName:avatarFileName(scan.account?.username),fetchImpl:fetch,nav:navigator,win:window,doc:document,ua:navigator.userAgent});
   analytics.track('avatar_download',method?{result,state,method}:{result,state});
   if(result==='success')showToast(AVATAR_TOAST[method]);else{setNotice('無法下載頭貼圖。');setAvatarLink(openUrl);}
  }finally{setBusy(false);}
 }
 return <div className="overview-actions"><div className="share-actions"><button className="cta-button" onClick={copy}>分享這次看到的線索</button><button className="cta-button cta-secondary" onClick={download} disabled={busy} aria-busy={busy}>{busy?'正在準備圖片…':'下載專屬頭貼'}</button></div>{notice&&<p role="status">{notice}{avatarLink&&<> <a href={avatarLink} target="_blank" rel="noopener noreferrer">點這裡開啟圖片</a>，長按即可儲存。</>}</p>}<div className="toast-region" role="status" aria-live="polite">{toast.n>0&&<div key={toast.n} className="toast">{toast.text}</div>}</div><div className="share-report-link"><span>看到疑似詐騙？</span><a href="https://fraudbuster.digiat.org.tw/" target="_blank" rel="noopener noreferrer">到數發部查詢或通報 ↗</a></div></div>
}
