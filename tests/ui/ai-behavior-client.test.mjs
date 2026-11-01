import test from 'node:test';
import assert from 'node:assert/strict';
import {loadAiBehavior,checkedAiResponse,policyWarningText} from '../../frontend/src/ai-behavior-client.mjs';
const scan={id:'scan-1',status:'completed',account:{username:'example'}};
const payload=(status,extra={})=>({scanId:scan.id,account:'example',status,...extra});
const ready=payload('ready',{result:{assessment:'insufficient_evidence',conclusion:'可核對的判斷',findings:[{title:'重複句型：',text:'解釋活動模式。'}],limitations:['private']}});
function transport(sequence){const calls=[];return {calls,fetchImpl:async(path,options)=>{calls.push({path,...options});const value=sequence.shift();assert.ok(value,'Unexpected request');return {ok:true,json:async()=>value};}};}
test('explicit account query checks capability then starts once and polls with GET',async()=>{const t=transport([payload('not_requested'),{enabled:true,configured:true},payload('processing'),payload('processing'),ready]);const states=[];const result=await loadAiBehavior(scan,{...t,allowGenerate:true,delay:async()=>{},onState:s=>states.push(s.status)});assert.deepEqual(t.calls.map(c=>c.method),['GET','GET','POST','GET','GET']);assert.deepEqual(states,['not_requested','processing','processing','ready']);assert.deepEqual(result.result,{assessment:'insufficient_evidence',conclusion:'可核對的判斷',findings:[{title:'重複句型',text:'解釋活動模式。'}]});assert.equal(t.calls[2].body,'{}');});
test('saved scan page and cached ready never generate',async()=>{for(const value of [ready,payload('not_requested')]){const t=transport([value]);await loadAiBehavior(scan,t);assert.deepEqual(t.calls.map(c=>c.method),['GET']);}});
test('disabled or unconfigured capabilities prevent POST',async()=>{for(const caps of [{enabled:false,configured:true},{enabled:true,configured:false},{}]){const t=transport([payload('not_requested'),caps]);const result=await loadAiBehavior(scan,{...t,allowGenerate:true});assert.ok(['disabled','not_configured'].includes(result.status));assert.equal(t.calls.length,2);assert.ok(t.calls.every(c=>c.method==='GET'));}});
test('all terminal states stop; retryAllowed never causes automatic repeat',async()=>{for(const status of ['invalid_output','indeterminate','preflight_failed','provider_rejected','budget_exceeded','disabled','not_configured','no_data','scan_not_ready','response_too_large']){const t=transport([payload(status,{retryAllowed:true,result:{conclusion:'must not render'}})]);const result=await loadAiBehavior(scan,{...t,allowGenerate:true});assert.equal(result.result,null);assert.equal(t.calls.length,1);}});
test('response identity, assessment and shape checked before display',()=>{for(const changed of [{account:'someone-else'},{scanId:'old-scan'},{status:'unknown'},{result:{...ready.result,assessment:'confirmed_identity'}},{result:{conclusion:'yes',findings:[{title:'x'}]}}])assert.throws(()=>checkedAiResponse({...ready,...changed},scan));});
test('non JSON failures never trigger generation',async()=>{let calls=0;await assert.rejects(loadAiBehavior(scan,{allowGenerate:true,fetchImpl:async()=>{calls++;return {ok:false,json:async()=>{throw Error('bad JSON')}};}}));assert.equal(calls,1);});
test('abort during polling prevents any further request or stale update',async()=>{const controller=new AbortController(),t=transport([payload('processing'),ready]);const seen=[];await assert.rejects(loadAiBehavior(scan,{...t,signal:controller.signal,onState:s=>seen.push(s.status),delay:async()=>controller.abort()}),{name:'AbortError'});assert.equal(t.calls.length,1);assert.deepEqual(seen,['processing']);});
test('polling is bounded without generating another job',async()=>{const t=transport(Array.from({length:81},()=>payload('processing')));const waits=[];const result=await loadAiBehavior(scan,{...t,delay:async ms=>{waits.push(ms);}});assert.equal(result.status,'waiting');assert.equal(t.calls.length,81);assert.ok(t.calls.every(c=>c.method==='GET'));assert.ok(waits.every(ms=>ms===1500));});
test('waits the server-given first delay, then polls every 1.5 s until ready',async()=>{const t=transport([payload('processing',{pollAfterMs:8000}),payload('processing',{pollAfterMs:1500}),ready]);const waits=[];const result=await loadAiBehavior(scan,{...t,delay:async ms=>{waits.push(ms);}});assert.equal(result.status,'ready');assert.deepEqual(waits,[8000,1500]);assert.equal(t.calls.length,3);});
test('polls at the server interval within the 500 ms to 10 s range, still bounded to about two minutes',async()=>{const waitsFor=async pollAfterMs=>{const t=transport(Array.from({length:300},()=>payload('processing',{pollAfterMs})));const waits=[];await loadAiBehavior(scan,{...t,delay:async ms=>{waits.push(ms);}});return waits;};assert.deepEqual(new Set(await waitsFor(1500)),new Set([1500]));assert.deepEqual(new Set(await waitsFor(100)),new Set([500]));const slow=await waitsFor(60000);assert.deepEqual(new Set(slow),new Set([10000]));assert.equal(slow.length,12);});
test('known wording warnings pass through for display; unknown codes are dropped',()=>{const r=checkedAiResponse({...ready,result:{...ready.result,policyWarnings:['unsupported_intent_or_operator','made_up']}},scan);assert.deepEqual(r.result.policyWarnings,['unsupported_intent_or_operator']);assert.equal(checkedAiResponse(ready,scan).result.policyWarnings,undefined);});
test('the misquote and identity-label warnings have display text (Felix 10-29)',()=>{for(const code of ['ungrounded_quote','identity_label'])assert.ok(policyWarningText[code],code);});
// signals-v3 item 8 (Felix 10-30): the content judgement rides along on the same response; a malformed one is dropped
// (item 8 then reads unknown) without touching the behaviour result, and polling waits for it too.
const hate={status:'ready',result:{hateful:true,quotes:[{evidenceId:'activity:p1',quote:'某群人都是害蟲'}],targets:['族群']}};
test('the content judgement is kept in shape or dropped, never breaking the behaviour result',()=>{
 assert.deepEqual(checkedAiResponse({...ready,content:hate},scan).content,hate);
 assert.deepEqual(checkedAiResponse({...ready,content:{status:'processing',result:{x:1}}},scan).content,{status:'processing',result:null});
 assert.deepEqual(checkedAiResponse({...ready,content:{status:'ready',result:{hateful:false,quotes:[{evidenceId:'a',quote:'b'}],targets:[]}}},scan).content.result.quotes,[],'a no carries no quotes');
 for(const bad of [{status:'ready',result:{hateful:'yes',quotes:[],targets:[]}},{status:'made_up'},'ready',null]){
  const r=checkedAiResponse({...ready,content:bad},scan);assert.equal(r.content,undefined,JSON.stringify(bad));assert.equal(r.result.assessment,'insufficient_evidence');
 }
});
test('polling continues while only the content judgement is still running, and gives it up as indeterminate',async()=>{
 const t=transport([{...ready,content:{status:'processing'}},{...ready,content:hate}]);
 const done=await loadAiBehavior(scan,{...t,delay:async()=>{}});
 assert.equal(t.calls.length,2);assert.deepEqual(done.content,hate);
 const stuck=transport(Array.from({length:81},()=>({...ready,content:{status:'processing'}})));
 const gaveUp=await loadAiBehavior(scan,{...stuck,delay:async()=>{}});
 assert.equal(gaveUp.status,'ready');assert.deepEqual(gaveUp.content,{status:'indeterminate',result:null});
});
