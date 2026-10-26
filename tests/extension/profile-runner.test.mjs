import test from 'node:test';
import assert from 'node:assert/strict';
import {createProfileRunner} from '../../extension/lib/profile-runner.mjs';
import {slot,recordRequest,noteOutcome,paused,PAUSE_MS,cachePut,emptyUsage,emptyBreaker} from '../../extension/lib/profile.mjs';
import {hovercard,hovercardMissing,about,pageScripts,COOKIE,COOKIE_SIGNED_OUT} from './fixtures/profile.mjs';
// 帳號背景 queue (EXTENSION-SPEC §4.4): the per-author states, the pacing through the background script, the switches
// and the stop rule, with a fake clock, a fake Threads and a background stand-in built from the same pure functions.
const NOON=Date.UTC(2026,9,24,4,0,0);
function world({cookie=COOKIE,scripts=pageScripts(),threads=null,switches={}}={}){
 let t=NOON;const now=()=>t;
 const sent=[],saved={},store={usage:emptyUsage(),breaker:emptyBreaker(),profiles:{}};
 const sw={setting:true,remote:true,...switches};
 const runtime={
  async profileSlot(){if(!sw.setting)return {ok:false,reason:'off'};if(!sw.remote)return {ok:false,reason:'remoteOff'};if(paused(store.breaker,t))return {ok:false,reason:'paused',retryAt:store.breaker.pausedAt+PAUSE_MS};const s=slot(store.usage,t);if(!s.allowed)return {ok:false,reason:s.reason,retryAt:s.retryAt};store.usage=recordRequest(store.usage,t);return {ok:true};},
  async profileOutcome(kind){store.breaker=noteOutcome(store.breaker,kind,t);const p=paused(store.breaker,t);return {ok:true,paused:p,retryAt:p?store.breaker.pausedAt+PAUSE_MS:null};},
  async profileSave(u,data){store.profiles=cachePut(store.profiles,u,data,t);saved[u]=data;return {ok:true};}
 };
 const answer=threads??((url,init)=>{const body=new URLSearchParams(init.body);if(url==='/graphql/query'){const u=JSON.parse(body.get('variables')).username;return u==='ghost'?{status:200,text:hovercardMissing()}:{status:200,text:hovercard({username:u,pk:String(1000+u.length)})};}return {status:200,text:about({joined:'2026年9月 · #1',country:'台灣'})};});
 const fetchImpl=async(url,init)=>{sent.push({url,at:t,body:init.body});const r=answer(url,init,sent.length);if(r instanceof Error)throw r;return {status:r.status,text:async()=>r.text};};
 const doc={location:{pathname:'/@op/post/X'},cookie,querySelectorAll:()=>[{textContent:scripts}]};
 let updates=0;
 const timers=[];
 const runner=createProfileRunner({runtime,doc,fetchImpl,now,onUpdate:()=>{updates++;},sleep:async ms=>{t+=ms;},setTimer:(fn,ms)=>{timers.push({fn,at:t+ms});return timers.length;},clearTimer:()=>{}});
 const settle=async()=>{for(let i=0;i<200;i++)await new Promise(r=>setImmediate(r));};
 return {runner,sent,saved,store,sw,settle,advance:ms=>{t+=ms;},now,updates:()=>updates,timers};
}
test('an on-screen author: queued → loading → ok with what Threads showed; two requests on one slot; saved for 7 days',async()=>{
 const w=world();
 assert.equal(w.runner.get('user01').status,'queued');
 w.runner.want(['user01']);await w.settle();
 const v=w.runner.get('user01');
 assert.equal(v.status,'ok');assert.deepEqual(v.data,{joined:{year:2026,month:9,text:'2026年9月 · #1'},country:'台灣',countryShared:true,renames:0},'only what is shown is kept: no follower count');
 assert.deepEqual(w.sent.map(s=>s.url.split('?')[0]),['/graphql/query','/async/wbloks/fetch/']);
 assert.equal(w.sent[1].at,w.sent[0].at,'the slot is per account: the second read goes at once (Felix 10-26)');assert.equal(w.store.usage.stamps.length,1,'one slot for the account');
 w.runner.want(['user01','user02']);await w.settle();
 assert.ok(w.sent[2].at-w.sent[1].at>=2000,'the next account waits for its slot');
 assert.match(w.sent[1].body,/target_user_id%22%3A%221006%22/,'the dialog asks by the id the hover card gave');
 assert.deepEqual(w.saved.user01,v.data);assert.ok(w.updates()>0);
});
test('only names on screen now are read, in order, each once; a cached one is not read again',async()=>{
 const w=world();
 w.runner.want(['user01','user02']);await w.settle();
 assert.equal(w.sent.length,4);
 w.runner.want(['user01','user02','bad name!']);await w.settle();
 assert.equal(w.sent.length,4,'cached: no new request; malformed names ignored');
 const fresh=world();fresh.advance(60000);fresh.runner.setCache(w.store.profiles);fresh.runner.want(['user02']);await fresh.settle();
 assert.equal(fresh.sent.length,0,'a cache from another tab or an earlier visit is used');assert.equal(fresh.runner.get('user02').status,'ok');
 // Scrolled away before its turn: never read.
 const w2=world();let calls=0;
 const slow=world({threads:(url,init)=>{calls++;if(calls===1)w2b.runner.want(['user09']);return {status:200,text:url==='/graphql/query'?hovercard({username:JSON.parse(new URLSearchParams(init.body).get('variables')).username}):about()};}});
 const w2b=slow;slow.runner.want(['user01','user02']);await slow.settle();
 assert.equal(slow.runner.get('user02').status,'queued','user02 left the screen before its turn');assert.equal(slow.runner.get('user09').status,'ok');
 void w2;
});
test('Threads has no such account: none, not a failure, nothing saved',async()=>{
 const w=world();w.runner.want(['ghost']);await w.settle();
 assert.equal(w.runner.get('ghost').status,'none');assert.equal(w.sent.length,1);assert.deepEqual(w.saved,{});assert.equal(w.store.breaker.fails,0);
});
test('signed out: nothing is requested and the reason is kept apart',async()=>{
 const w=world({cookie:COOKIE_SIGNED_OUT});w.runner.want(['user01']);await w.settle();
 assert.equal(w.sent.length,0);assert.equal(w.runner.blocked,'signedOut');assert.equal(w.runner.get('user01').status,'signedOut');
});
test('switched off in the popup or by the remote switch: nothing is requested; resume() tries again once back on',async()=>{
 for(const [key,reason] of [['setting','off'],['remote','remoteOff']]){
  const w=world({switches:{[key]:false}});w.runner.want(['user01']);await w.settle();
  assert.equal(w.sent.length,0);assert.equal(w.runner.blocked,reason);assert.equal(w.runner.get('user01').status,reason);
  w.sw[key]=true;w.runner.resume();await w.settle();
  assert.equal(w.runner.get('user01').status,'ok');assert.equal(w.runner.blocked,null);
 }
});
test('the hourly cap stops the queue until the oldest request leaves the hour',async()=>{
 const w=world();w.store.usage={stamps:Array.from({length:60},(_,i)=>NOON-3000000+i*1000)};
 w.runner.want(['user01']);await w.settle();
 assert.equal(w.sent.length,0);assert.equal(w.runner.blocked,'hourly');assert.equal(w.runner.retryAt,NOON-3000000+3600000);
 assert.equal(w.runner.get('user01').status,'hourly');
 assert.equal(w.timers.length,1,'one wake-up when the hour frees a slot');
 w.store.usage=emptyUsage();w.advance(3600000);w.timers[0].fn();await w.settle();
 assert.equal(w.runner.get('user01').status,'ok','read once the cap lifted');
});
test('stop rule: three refusals in a row pause the lookups (shown, not silent); each failed author is "failed", never empty',async()=>{
 const w=world({threads:()=>({status:429,text:''})});
 w.runner.want(['user01','user02','user03','user04']);await w.settle();
 assert.equal(w.sent.length,3,'three refusals, then nothing more');
 assert.equal(paused(w.store.breaker,w.now()),true);assert.equal(w.store.breaker.reason,'refused');
 assert.deepEqual(['user01','user02','user03'].map(u=>w.runner.get(u).status),['failed','failed','failed']);
 assert.equal(w.runner.get('user04').status,'paused');assert.equal(w.runner.blocked,'paused');
});
test('stop rule: the third refusal shows the pause at once, even with no other author waiting; it lifts after the pause',async()=>{
 const w=world({threads:()=>({status:403,text:''})});
 w.runner.want(['user01','user02','user03']);await w.settle();
 assert.equal(w.sent.length,3);
 assert.equal(w.runner.blocked,'paused');assert.equal(w.runner.retryAt,w.store.breaker.pausedAt+PAUSE_MS);
 assert.ok(w.timers.some(x=>x.at>=w.runner.retryAt),'a wake-up is set for when the pause ends');
});
test('stop rule: an answer that no longer parses counts too; a success in between starts the count again',async()=>{
 const w=world({threads:(url,init)=>{if(url==='/graphql/query'){const u=JSON.parse(new URLSearchParams(init.body).get('variables')).username;return {status:200,text:u==='user02'?hovercard({username:'user02',pk:'2'}):'<html>changed</html>'};}return {status:200,text:about()};}});
 w.runner.want(['user01','user02','user03','user04','user05']);await w.settle();
 assert.equal(w.runner.get('user01').status,'failed');assert.equal(w.runner.get('user02').status,'ok','success resets the count');
 assert.equal(paused(w.store.breaker,w.now()),true,'then three unreadable answers in a row');assert.equal(w.store.breaker.reason,'parse');
});
test('a page without the tokens while signed in counts as the layout changing; network errors do not count and are retried later',async()=>{
 const w=world({scripts:'nothing'});w.runner.want(['user01']);await w.settle();
 assert.equal(w.sent.length,0);assert.equal(w.store.breaker.fails>=1,true);assert.equal(w.runner.get('user01').status,'failed');
 const net=world({threads:()=>new Error('offline')});net.runner.want(['user01']);await net.settle();
 assert.equal(net.runner.get('user01').status,'failed');assert.equal(net.store.breaker.fails,0);
 const before=net.sent.length;net.runner.want(['user01']);await net.settle();assert.equal(net.sent.length,before,'not retried at once');
 net.advance(10*60000);net.runner.want(['user01']);await net.settle();assert.equal(net.sent.length,before+1,'retried after ten minutes');
});
