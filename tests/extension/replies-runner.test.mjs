import test from 'node:test';
import assert from 'node:assert/strict';
import {createRepliesReader} from '../../extension/lib/replies-runner.mjs';
import {PARENT_FILL_MAX} from '../../extension/lib/replies.mjs';
import {post,repliesBody,postPageHtml} from './fixtures/replies.mjs';
import {hovercard,hovercardMissing,pageScripts,COOKIE,COOKIE_SIGNED_OUT} from './fixtures/profile.mjs';
// The read behind one 「AI 打詐」 press (lib/replies-runner.mjs): the hover card, one page of replies, the logged-out
// parent fill-in, through 帳號背景's pacing and stop rule. A fake page, a fake runtime, a scripted fetch.
const T0=Date.UTC(2026,9,30,3,0,0);
const RELAY='{"__relay_internal__pv__BarcelonaIsLoggedInrelayprovider":true}';
const thread=(i,{parent='star',text=`第 ${i} 則`}={})=>[post({username:parent,ms:T0-i*3600000-60000,text:`原文 ${i}`}),post({username:'sample',ms:T0-i*3600000,n:2,text,reply:parent})];
function world({cookie=COOKIE,scripts=`${pageScripts()}\n${RELAY}`,card=hovercard({username:'sample',pk:'63483207811'}),page=repliesBody([1,2,3,4,5,6].map(i=>thread(i))),pages={},statuses={},slots=null}={}){
 const doc={cookie,location:{pathname:'/@someone/post/ABC'},querySelectorAll:()=>[{textContent:scripts}]};
 const calls=[],outcomes=[];let slotCalls=0;
 const runtime={profileSlot:async()=>{slotCalls++;return slots?slots(slotCalls):{ok:true,remaining:9};},profileOutcome:async kind=>{outcomes.push(kind);return {ok:true};}};
 const fetchImpl=async(url,init={})=>{
  calls.push({url,method:init.method??'GET',credentials:init.credentials??null,name:init.headers?.['X-FB-Friendly-Name']??null,body:init.body??null});
  const status=statuses[calls.length]??200,text=async()=>typeof body==='string'?body:'';
  let body;
  if(url==='/graphql/query')body=init.headers['X-FB-Friendly-Name']==='BarcelonaUsernameHovercardImplDirectQuery'?card:page;
  else body=pages[url]??'<!doctype html><html></html>';
  return {status,text:async()=>body};
 };
 const read=createRepliesReader({runtime,doc,fetchImpl,now:()=>T0,sleep:async()=>{}});
 return {read,calls,outcomes,get slotCalls(){return slotCalls;}};
}

test('a full read: one slot, the hover card then the Replies page with the user id, rows with their parents, nothing to Whospost from here',async()=>{
 const w=world();
 const r=await w.read('Sample',{repliesQuery:{docId:'39901003386179772',first:25}});
 assert.equal(r.ok,true,JSON.stringify(r));
 assert.equal(r.rows.length,6);assert.equal(r.rows[0].parentAuthor,'star');assert.deepEqual(Object.keys(r.rows[0]),['id','text','postedAt','url','parentUrl','parentAuthor','isQuote','isRepost']);
 assert.deepEqual(r.stats,{own:6,selfThread:0,hidden:0,filled:0,gone:0,errors:false,readMs:0,ms:0});
 assert.equal(w.slotCalls,1,'one slot for the account, shared by the two requests');
 assert.deepEqual(w.calls.map(c=>[c.url,c.name,c.credentials]),[['/graphql/query','BarcelonaUsernameHovercardImplDirectQuery','include'],['/graphql/query','BarcelonaProfileRepliesTabRefetchableDirectQuery','include']]);
 const vars=JSON.parse(new URLSearchParams(w.calls[1].body).get('variables'));
 assert.equal(vars.userID,'63483207811');assert.equal(vars.first,25);assert.equal(new URLSearchParams(w.calls[1].body).get('doc_id'),'39901003386179772');
 assert.deepEqual(w.outcomes,['ok']);
 assert.equal(w.calls.some(c=>/whospost/i.test(`${c.url} ${c.body}`)),false);
});

test('not signed in, tokens missing, no slot, no such account: nothing is read and nothing counted against the stop rule',async()=>{
 assert.deepEqual((await world({cookie:COOKIE_SIGNED_OUT}).read('sample')).code,'SIGNED_OUT');
 assert.deepEqual((await world({scripts:'nothing here'}).read('sample')).code,'TOKENS');
 assert.deepEqual((await world({scripts:pageScripts()}).read('sample')).code,'TOKENS','a page without relay flags');
 const blocked=world({slots:()=>({ok:false,reason:'hourly',retryAt:T0+1000})});
 assert.equal((await blocked.read('sample')).code,'BLOCKED');assert.equal(blocked.calls.length,0,'no request without a slot');
 const gap=world({slots:n=>n===1?{ok:false,reason:'gap',retryAt:T0+500}:{ok:true}});
 assert.equal((await gap.read('sample')).ok,true,'a 2-second gap is waited out');assert.equal(gap.slotCalls,2);
 const none=world({card:hovercardMissing()});
 assert.equal((await none.read('sample')).code,'NO_USER');assert.equal(none.calls.length,1);
});

test('Threads refuses or answers nonsense: counted toward the stop rule, the read fails without retry',async()=>{
 const refused=world({statuses:{1:429}});
 assert.equal((await refused.read('sample')).code,'REFUSED');assert.deepEqual(refused.outcomes,['refused']);assert.equal(refused.calls.length,1);
 const forbidden=world({statuses:{2:403}});
 assert.equal((await forbidden.read('sample')).code,'REFUSED');assert.deepEqual(forbidden.outcomes,['refused']);
 const down=world({statuses:{2:500}});
 assert.equal((await down.read('sample')).code,'HTTP_500');assert.deepEqual(down.outcomes,['error']);
 const stale=world({page:'{"errors":[{"message":"execution error"}]}'});
 assert.equal((await stale.read('sample')).code,'QUERY','a stale query id');assert.deepEqual(stale.outcomes,['parse']);
 const html=world({page:'<!doctype html>'});
 assert.equal((await html.read('sample')).code,'PARSE');
 const few=world({page:repliesBody([thread(1),thread(2)])});
 const r=await few.read('sample');assert.equal(r.code,'TOO_FEW');assert.equal(r.stats.own,2);
});

test('hidden parents: filled in from the logged-out post page, credentials omitted; gone for everyone stays null; too many hidden and nothing is sent',async()=>{
 const parent=post({username:'hkj331155',ms:T0-90000,text:'上層'}),hidden=post({username:'sample',ms:T0-60000,text:'被藏的',hidden:true}),gone=post({username:'sample',ms:T0-50000,text:'沒了',hidden:true});
 const visible=[1,2,3,4,5].map(i=>thread(i));
 const pages={[`/@sample/post/${hidden.code}`]:postPageHtml({...hidden,text_post_app_info:{...hidden.text_post_app_info,reply_to_author:{username:'hkj331155'},parent_post_unavailable_reason:null}},[parent,hidden]),[`/@sample/post/${gone.code}`]:postPageHtml(gone,[gone])};
 const w=world({page:repliesBody([...visible,[hidden],[gone]]),pages});
 const r=await w.read('sample');
 assert.equal(r.ok,true,JSON.stringify(r));
 assert.equal(r.rows.length,7);
 const filled=r.rows.find(x=>x.url.endsWith(hidden.code)),left=r.rows.find(x=>x.url.endsWith(gone.code));
 assert.equal(filled.parentAuthor,'hkj331155');assert.equal(filled.parentUrl,`https://www.threads.com/@hkj331155/post/${parent.code}`);
 assert.equal(left.parentUrl,null);
 assert.deepEqual({hidden:r.stats.hidden,filled:r.stats.filled,gone:r.stats.gone},{hidden:2,filled:1,gone:1});
 const pageCalls=w.calls.filter(c=>c.url.startsWith('/@sample/post/'));
 assert.equal(pageCalls.length,2);assert.ok(pageCalls.every(c=>c.credentials==='omit'),'logged out');
 // A wall (no reply in the page) leaves the row as it was.
 const wall=world({page:repliesBody([...visible,[hidden]]),pages:{[`/@sample/post/${hidden.code}`]:postPageHtml(hidden,[hidden],{wall:true})}});
 const r2=await wall.read('sample');assert.equal(r2.ok,true);assert.equal(r2.rows.find(x=>x.url.endsWith(hidden.code)).parentUrl,null);assert.equal(r2.stats.filled,0);assert.equal(r2.stats.gone,0);
 // More hidden than PARENT_FILL_MAX: not sent, no page read.
 const many=world({page:repliesBody([...visible,...Array.from({length:PARENT_FILL_MAX+1},(_,i)=>[post({username:'sample',ms:T0-1000*(i+1),text:`藏 ${i}`,hidden:true})])])});
 const r3=await many.read('sample');
 assert.equal(r3.ok,false);assert.equal(r3.code,'HIDDEN');assert.equal(r3.stats.hidden,PARENT_FILL_MAX+1);
 assert.equal(many.calls.filter(c=>c.url.startsWith('/@')).length,0);
});
