import React,{useEffect,useState} from 'react';
import entries from './data/approved-ai-behavior.json';
import {approvedAiForScan,aiEvidenceSignature} from './ai-behavior-model.mjs';
import {analytics} from './analytics.mjs';
import {loadAiBehavior,aiStatusText,policyWarningText} from './ai-behavior-client.mjs';

export default function AiBehavior({scan,allowGenerate=false}){
 const [state,setState]=useState({key:null,status:'loading',result:null});
 const [reload,setReload]=useState(0);
 let signature;try{signature=aiEvidenceSignature(scan);}catch{signature=null;}
 const key=signature===null?null:`${scan.id}:${signature}`;
 useEffect(()=>{
  const controller=new AbortController();
  const update=value=>{if(!controller.signal.aborted)setState({key,...value});};
  update({status:'loading',result:null});
  async function load(){
   try{
    if(!key)throw Error('Invalid evidence');
    const approved=await approvedAiForScan(scan,entries);
    if(controller.signal.aborted)return;
    if(approved){update({status:'ready',result:approved});return;}
    await loadAiBehavior(scan,{signal:controller.signal,allowGenerate:allowGenerate&&reload===0,onState:update});
   }catch{if(!controller.signal.aborted){update({status:'unavailable',result:null});analytics.trackOnce('error:ai_load','app_error',{kind:'ai_load'});}}
  }
  load();return()=>controller.abort();
 },[key,allowGenerate,reload]);
 const current=state.key===key?state:{status:'loading',result:null};
 const pending=['loading','processing'].includes(current.status);
 return <section className="ai-behavior" aria-label="AI 行為判斷" aria-live="polite" aria-busy={pending}>
  <span className="ai-label">AI 行為判斷</span>
  {current.status==='ready'&&current.result?<>
   <p className="ai-conclusion">{current.result.conclusion}</p>
   <ul className="ai-findings">{current.result.findings.map((f,i)=><li key={i}><strong>{f.title}：</strong>{f.text}</li>)}</ul>
   {current.result.policyWarnings?.length>0&&<p className="ai-warning">自動檢查提醒：這段判斷可能有「{current.result.policyWarnings.map(w=>policyWarningText[w]).join('、')}」的用語，請當作參考，不是定論。</p>}
  </>:<p className="ai-status" role="status">{aiStatusText[current.status]??aiStatusText.unavailable}</p>}
  {['unavailable','waiting'].includes(current.status)&&<button type="button" className="ai-reload" onClick={()=>setReload(n=>n+1)}>重新載入判斷</button>}
 </section>;
}
