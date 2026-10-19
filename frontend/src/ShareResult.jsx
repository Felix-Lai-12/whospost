import React,{useEffect,useRef,useState} from 'react';
import {resultShareUrl,resultShareText} from '../../shared/share.mjs';
import {analytics} from './analytics.mjs';
export default function ShareResult({scan}){
 const [notice,setNotice]=useState('');
 const [toast,setToast]=useState(0);
 const timer=useRef();
 useEffect(()=>()=>clearTimeout(timer.current),[]);
 const text=resultShareText(resultShareUrl(location.origin,location.pathname,scan.id));
 // Clipboard API can be blocked by permissions; fall back to a temporary textarea copy.
 function legacyCopy(){const area=document.createElement('textarea');area.value=text;area.setAttribute('readonly','');area.style.position='fixed';area.style.opacity='0';document.body.appendChild(area);area.select();let ok=false;try{ok=document.execCommand('copy')}catch{}area.remove();return ok}
 async function copy(){let ok=false;try{await navigator.clipboard.writeText(text);ok=true}catch{ok=legacyCopy()}analytics.track('share_copy',{result:ok?'success':'fail'});if(ok){setNotice('');clearTimeout(timer.current);setToast(t=>t+1);timer.current=setTimeout(()=>setToast(0),2600)}else setNotice(`無法自動複製，請手動複製：${text}`)}
 return <div className="overview-actions"><div className="share-actions"><button className="cta-button" onClick={copy}>分享這次看到的線索</button></div>{notice&&<p role="status">{notice}</p>}<div className="toast-region" role="status" aria-live="polite">{toast>0&&<div key={toast} className="toast">已複製分享文字</div>}</div><div className="share-report-link"><span>看到疑似詐騙？</span><a href="https://fraudbuster.digiat.org.tw/" target="_blank" rel="noopener noreferrer">到數發部查詢或通報 ↗</a></div></div>
}
