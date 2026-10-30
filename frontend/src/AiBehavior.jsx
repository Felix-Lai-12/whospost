import React,{useEffect,useState} from 'react';
import entries from './data/approved-ai-behavior.json';
import {approvedAiForScan,aiEvidenceSignature} from './ai-behavior-model.mjs';
import {analytics} from './analytics.mjs';
import {loadAiBehavior,aiStatusText,policyWarningText} from './ai-behavior-client.mjs';

// onState hears every state this section shows ({status, result, content}), so the score card can count both AI
// judgements as items 7 and 8 (signals-v3) from the same answer instead of asking again.
export default function AiBehavior({scan,allowGenerate=false,onState=()=>{}}){
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
    // An approved behaviour text stands as it is; the content judgement (item 8) is still read from the site, never
    // generated here, and a failure to read it only leaves item 8 unknown.
    if(approved){
     update({status:'ready',result:approved});
     try{await loadAiBehavior(scan,{signal:controller.signal,allowGenerate:false,onState:v=>{if(v.content)update({status:'ready',result:approved,content:v.content});}});}catch(e){if(e?.name==='AbortError')throw e;}
     return;
    }
    await loadAiBehavior(scan,{signal:controller.signal,allowGenerate:allowGenerate&&reload===0,onState:update});
   }catch{if(!controller.signal.aborted){update({status:'unavailable',result:null});analytics.trackOnce('error:ai_load','app_error',{kind:'ai_load'});}}
  }
  load();return()=>controller.abort();
 },[key,allowGenerate,reload]);
 const current=state.key===key?state:{status:'loading',result:null};
 useEffect(()=>{onState({status:current.status,result:current.result,content:current.content});},[current.status,current.result,current.content]);
 const content=current.content?.status==='ready'&&current.content.result?.hateful?current.content.result:null;
 const rows=new Map([...(scan.posts??[]),...(scan.authoredReplies??scan.comments??[])].map(r=>[`activity:${r.id}`,r]));
 const pending=['loading','processing'].includes(current.status);
 return <section className="ai-behavior" aria-label="AI 行為判斷" aria-live="polite" aria-busy={pending}>
  <span className="ai-label">AI 行為判斷</span>
  {current.status==='ready'&&current.result?<>
   <p className="ai-conclusion">{current.result.conclusion}</p>
   <ul className="ai-findings">{current.result.findings.map((f,i)=><li key={i}><strong>{f.title}：</strong>{f.text}</li>)}</ul>
   {current.result.policyWarnings?.length>0&&<p className="ai-warning">自動檢查提醒：這段判斷可能有「{current.result.policyWarnings.map(w=>policyWarningText[w]).join('、')}」的用語，請當作參考，不是定論。</p>}
  </>:<p className="ai-status" role="status">{aiStatusText[current.status]??aiStatusText.unavailable}</p>}
  {content&&<div className="ai-content" role="note">
   <strong>AI 判讀內容異常：</strong>找到針對{content.targets.length?content.targets.join('、'):'身分群體'}的高度仇恨言論（AI 判讀，可能判錯；不確定時不會標出）。
   <ul>{content.quotes.map((q,i)=>{const url=rows.get(q.evidenceId)?.url;return <li key={i}>「{q.quote}」{url&&<> <a href={url} target="_blank" rel="noopener noreferrer">看原文 ↗</a></>}</li>;})}</ul>
  </div>}
  {['unavailable','waiting'].includes(current.status)&&<button type="button" className="ai-reload" onClick={()=>setReload(n=>n+1)}>重新載入判斷</button>}
 </section>;
}
