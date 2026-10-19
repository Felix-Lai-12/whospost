// GET is read-only. New work requires this session's account query and enabled server capabilities.
const statuses=new Set(['ready','processing','not_requested','scan_not_ready','no_data','disabled','not_configured','budget_exceeded','preflight_failed','invalid_output','indeterminate','response_too_large']);
// Wording rules the judgement tripped; it is still shown, with this reminder.
export const policyWarningText={unsupported_intent_or_operator:'推測動機或背後經營者',missing_parent_context:'沒有原串內容卻評論是否切題',sample_as_full_history:'把這次樣本當成完整紀錄'};
const warningsOf=r=>{const w=(Array.isArray(r.policyWarnings)?r.policyWarnings:[]).filter(x=>Object.hasOwn(policyWarningText,x));return w.length?{policyWarnings:w}:{};};
export const aiStatusText={loading:'正在載入 AI 判斷…',processing:'AI 正在判讀這次的發文與留言…',not_requested:'這筆結果尚未產生 AI 判斷。',scan_not_ready:'帳號資料仍在處理，尚未開始 AI 判讀。',no_data:'沒有可分析的發文或留言，尚無法判斷。',disabled:'AI 自動判讀尚未啟用。',not_configured:'AI 服務尚未設定。',budget_exceeded:'AI 判讀預算不足，這次未產生判斷。',preflight_failed:'AI 判讀前的檢查未完成，這次尚未產生判斷。',invalid_output:'AI 輸出未通過檢查，暫不顯示判斷。',indeterminate:'AI 請求狀態尚未確認，暫不重送。',response_too_large:'這次資料超過 AI 判讀範圍。',waiting:'AI 判讀仍在處理，稍後可重新載入判斷。',unavailable:'AI 判斷暫時無法載入，請稍後重新載入。'};
export function checkedAiResponse(value,scan){
 if(!value||value.scanId!==scan.id||value.account!==scan.account.username||!statuses.has(value.status))throw Error('AI response does not match scan');
 if(value.status!=='ready')return {...value,result:null};
 const r=value.result;
 if(!r||!['suspicious_behavior_observed','no_clear_suspicious_behavior','insufficient_evidence'].includes(r.assessment)||typeof r.conclusion!=='string'||!r.conclusion.trim()||!Array.isArray(r.findings)||r.findings.length>4||r.findings.some(f=>typeof f.title!=='string'||!f.title.trim()||typeof f.text!=='string'||!f.text.trim()))throw Error('Invalid AI result');
 return {...value,result:{assessment:r.assessment,conclusion:r.conclusion,findings:r.findings.map(f=>({title:f.title.replace(/[：:]$/u,''),text:f.text})),...warningsOf(r)}};
}
export async function loadAiBehavior(scan,{fetchImpl=globalThis.fetch,signal,onState=()=>{},allowGenerate=false,delay=ms=>new Promise((resolve,reject)=>{const timer=setTimeout(done,ms);function done(){signal?.removeEventListener('abort',abort);resolve();}function abort(){clearTimeout(timer);reject(new DOMException('Aborted','AbortError'));}if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});})}={}){
 const path=`/api/scans/${encodeURIComponent(scan.id)}/ai`;
 const checkAbort=()=>{if(signal?.aborted)throw new DOMException('Aborted','AbortError');};
 const emit=value=>{checkAbort();onState(value);};
 const request=async(method='GET')=>{
  checkAbort();
  const response=await fetchImpl(path,{method,signal,...(method==='POST'?{headers:{'Content-Type':'application/json'},body:'{}'}:{})});
  const value=checkedAiResponse(await response.json(),scan);checkAbort();
  if(!response.ok&&!['disabled','not_configured','budget_exceeded','invalid_output','indeterminate','preflight_failed','no_data','scan_not_ready','response_too_large'].includes(value.status))throw Error('AI request failed');
  return value;
 };
 let state=await request();emit(state);
 if(state.status==='not_requested'&&allowGenerate&&scan.status==='completed'){
  checkAbort();const response=await fetchImpl('/api/ai/status',{method:'GET',signal});
  if(!response.ok)throw Error('AI capabilities unavailable');
  const caps=await response.json();checkAbort();
  if(caps.enabled!==true)state={status:'disabled',result:null};
  else if(caps.configured!==true)state={status:'not_configured',result:null};
  else state=await request('POST');
  emit(state);
 }
 // About two minutes of polling, the same window after which the server reports a stuck job as indeterminate.
 for(let waited=0;state.status==='processing'&&waited<120000;){
  const ms=Math.min(10000,Math.max(500,Number.isFinite(state.pollAfterMs)?state.pollAfterMs:1000));
  await delay(ms);waited+=ms;
  checkAbort();state=await request();emit(state);
 }
 if(state.status==='processing'){state={status:'waiting',result:null};emit(state);}
 return state;
}
