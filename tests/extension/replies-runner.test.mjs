import test from 'node:test';
import assert from 'node:assert/strict';
import {createRepliesReader,DOC_TTL} from '../../extension/lib/replies-runner.mjs';
import {PARENT_FILL_MAX,DEFAULT_DOC_ID} from '../../extension/lib/replies.mjs';
import {post,repliesBody,postPageHtml} from './fixtures/replies.mjs';
import {hovercard,hovercardMissing,pageScripts,COOKIE,COOKIE_SIGNED_OUT} from './fixtures/profile.mjs';
// The read behind one 「AI 打詐」 press (lib/replies-runner.mjs): the hover card, one page of replies, the logged-out
// parent fill-in, through 帳號背景's pacing and stop rule. A fake page, a fake runtime, a scripted fetch.
const T0=Date.UTC(2026,9,30,3,0,0);
const RELAY='{"__relay_internal__pv__BarcelonaIsLoggedInrelayprovider":true}';
const thread=(i,{parent='star',text=`第 ${i} 則`}={})=>[post({username:parent,ms:T0-i*3600000-60000,text:`原文 ${i}`}),post({username:'sample',ms:T0-i*3600000,n:2,text,reply:parent})];
// The Replies-tab module as Threads' bundles define it (2026-11-09), and the CDN those bundles come from.
const PAGE_DOC='29693317360358767',SITE_DOC='39901003386179772',CDN='https://static.cdninstagram.com/rsrc.php/v4/';
const bundle=(id=PAGE_DOC,name='BarcelonaProfileRepliesTabRefetchableDirectQuery')=>`;/*FB_PKG_DELIM*/\n__d("BarcelonaOther",[],(function(t,n,r,o,a,i){a.exports="1111111111111"}),null);\n__d("${name}_threadsRelayOperation",[],(function(t,n,r,o,a,i){a.exports="${id}"}),null);`;
const repliesHtml=srcs=>`<!doctype html><html><head>${srcs.map(u=>`<link rel="preload" href="${u}" as="script"><script src="${u}" async></script>`).join('')}</head></html>`;
// statuses: by the number of the Threads request (hover card 1, Replies page 2, post pages after), not counting the
// query-id look (the /replies page and the scripts), which `lookups` lists apart.
function world({cookie=COOKIE,scripts=`${pageScripts()}\n${RELAY}`,card=hovercard({username:'sample',pk:'63483207811'}),page=repliesBody([1,2,3,4,5,6].map(i=>thread(i))),pages={},statuses={},slots=null,here=[],perf=[],bundles={},clock=null}={}){
 const doc={cookie,location:{pathname:'/@someone/post/ABC'},querySelectorAll:sel=>sel==='script[src]'?here.map(src=>({src})):[{textContent:scripts}]};
 const calls=[],lookups=[],outcomes=[];let slotCalls=0;
 const runtime={profileSlot:async()=>{slotCalls++;return slots?slots(slotCalls):{ok:true,remaining:9};},profileOutcome:async kind=>{outcomes.push(kind);return {ok:true};}};
 const fetchImpl=async(url,init={})=>{
  const call={url,method:init.method??'GET',credentials:init.credentials??null,cache:init.cache??null,name:init.headers?.['X-FB-Friendly-Name']??null,body:init.body??null};
  if(url.startsWith(CDN)){lookups.push(call);if(!(url in bundles))throw new TypeError('Failed to fetch');return {status:200,text:async()=>bundles[url]};}
  if(/^\/@[^/]+\/replies$/.test(url)){lookups.push(call);return {status:200,text:async()=>pages[url]??'<!doctype html><html></html>'};}
  calls.push(call);
  const status=statuses[calls.length]??200;
  let body;
  if(url==='/graphql/query')body=init.headers['X-FB-Friendly-Name']==='BarcelonaUsernameHovercardImplDirectQuery'?card:page;
  else body=pages[url]??'<!doctype html><html></html>';
  return {status,text:async()=>body};
 };
 const read=createRepliesReader({runtime,doc,perf:{getEntriesByType:t=>t==='resource'?perf.map(name=>({name})):[]},fetchImpl,now:clock??(()=>T0),sleep:async()=>{}});
 const docIdSent=()=>new URLSearchParams(calls.filter(c=>c.name==='BarcelonaProfileRepliesTabRefetchableDirectQuery').at(-1)?.body??'').get('doc_id');
 return {read,calls,lookups,outcomes,docIdSent,get slotCalls(){return slotCalls;}};
}

test('a full read: one slot, the hover card then the Replies page with the user id, rows with their parents, nothing to Whospost from here',async()=>{
 const w=world();
 const r=await w.read('Sample',{repliesQuery:{docId:'39901003386179772',first:25}});
 assert.equal(r.ok,true,JSON.stringify(r));
 assert.equal(r.rows.length,6);assert.equal(r.rows[0].parentAuthor,'star');assert.deepEqual(Object.keys(r.rows[0]),['id','text','postedAt','url','parentUrl','parentAuthor','isQuote','isRepost']);
 assert.deepEqual(r.stats,{own:6,selfThread:0,hidden:0,filled:0,gone:0,errors:false,docSource:'site',readMs:0,ms:0});
 assert.deepEqual(w.lookups.map(c=>[c.url,c.credentials]),[['/@sample/replies','include']],'the query id looked for on the account\'s Replies tab, which shows none here');
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

// The query id (11-09): Threads' own scripts first, then the site's, then DEFAULT_DOC_ID.
test('query id from this page: a Replies tab carries the module in a script it loaded; no /replies page is fetched',async()=>{
 const url=`${CDN}a.js?_nc_x=1`;
 const w=world({here:[`${CDN}other.js`,url],bundles:{[`${CDN}other.js`]:bundle('2903124417651450','BarcelonaProfileRepliesTabDirectQuery'),[url]:bundle()}});
 const r=await w.read('sample',{repliesQuery:{docId:SITE_DOC,first:25}});
 assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.stats.docSource,'page');
 assert.equal(w.docIdSent(),PAGE_DOC,'the page\'s id over the site\'s');
 assert.deepEqual(w.lookups.map(c=>[c.url,c.credentials,c.cache]),[[`${CDN}other.js`,'omit','force-cache'],[url,'omit','force-cache']],'the scripts read from the cache, no cookie; the Threads-tab query beside it is not taken');
 const perf=world({perf:[url,'https://www.threads.com/ajax/bz','https://evil.example/x.js'],bundles:{[url]:bundle()}});
 assert.equal((await perf.read('sample')).stats.docSource,'page','scripts the page loaded later, from its resource list');
 assert.deepEqual(perf.lookups.map(c=>c.url),[url],'only Meta\'s static hosts are read');
 const data=world({here:[`data:application/x-javascript; charset=utf-8;base64,${Buffer.from(bundle()).toString('base64')}`]});
 const rd=await data.read('sample');assert.equal(rd.stats.docSource,'page','a data: script, decoded, not fetched');assert.equal(data.lookups.length,0);
});

test('query id from the account\'s Replies tab: fetched signed in, the scripts it lists read until the module turns up',async()=>{
 const a=`${CDN}a.js`,b=`${CDN}b.js?x=1&amp;y=2`,c=`${CDN}c.js`;
 const w=world({pages:{'/@sample/replies':repliesHtml([a,b,c])},bundles:{[a]:'__d("X",[],(function(){}),null);',[`${CDN}b.js?x=1&y=2`]:bundle(),[c]:bundle('99999999999')}});
 const r=await w.read('Sample',{repliesQuery:{docId:SITE_DOC,first:25}});
 assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.stats.docSource,'page');assert.equal(w.docIdSent(),PAGE_DOC);
 assert.deepEqual(w.lookups.map(x=>[x.url,x.credentials]),[['/@sample/replies','include'],[a,'omit'],[`${CDN}b.js?x=1&y=2`,'omit']],'stops at the first script with the module');
 assert.deepEqual(w.calls.map(x=>x.name),['BarcelonaUsernameHovercardImplDirectQuery','BarcelonaProfileRepliesTabRefetchableDirectQuery']);
});

test('query id fallbacks: nothing on the page or the Replies tab → the site\'s; no site value → DEFAULT_DOC_ID; a broken look never stops the read',async()=>{
 const site=world({here:[`${CDN}gone.js`],pages:{'/@sample/replies':repliesHtml([`${CDN}gone.js`])}});
 const r=await site.read('sample',{repliesQuery:{docId:SITE_DOC,first:25}});
 assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.stats.docSource,'site');assert.equal(site.docIdSent(),SITE_DOC);
 const none=world();
 const rn=await none.read('sample',null);assert.equal(rn.stats.docSource,'default');assert.equal(none.docIdSent(),DEFAULT_DOC_ID);
 const badSite=world();
 assert.equal((await badSite.read('sample',{repliesQuery:{docId:'nope'}})).stats.docSource,'default');
 const odd=world({pages:{'/@sample/replies':repliesHtml([`${CDN}a.js`])},bundles:{[`${CDN}a.js`]:bundle('12ab')}});
 assert.equal((await odd.read('sample',{repliesQuery:{docId:SITE_DOC}})).stats.docSource,'site','a module whose export is not an id is not taken');
});

test('query id is looked for once a tab per hour; a page id Threads refuses is looked for again at the next press',async()=>{
 let t=T0;const url=`${CDN}a.js`;
 const w=world({pages:{'/@sample/replies':repliesHtml([url])},bundles:{[url]:bundle()},clock:()=>t});
 await w.read('sample');await w.read('sample');
 assert.equal(w.lookups.filter(c=>c.url==='/@sample/replies').length,1,'kept within the hour');
 t+=DOC_TTL+1;await w.read('sample');
 assert.equal(w.lookups.filter(c=>c.url==='/@sample/replies').length,2,'looked again after it');
 const empty=world({clock:()=>t});await empty.read('sample');await empty.read('sample');
 assert.equal(empty.lookups.length,1,'finding nothing is kept too: no /replies page on every press');
 const stale=world({page:'{"errors":[{"message":"missing_required_variable_value"}]}',pages:{'/@sample/replies':repliesHtml([url])},bundles:{[url]:bundle()}});
 const r=await stale.read('sample',{repliesQuery:{docId:SITE_DOC}});
 assert.equal(r.code,'QUERY');assert.equal(r.stats.docSource,'page');
 await stale.read('sample',{repliesQuery:{docId:SITE_DOC}});
 assert.equal(stale.lookups.filter(c=>c.url==='/@sample/replies').length,2,'a refused page id is not kept');
 const staleSite=world({page:'{"errors":[{"message":"x"}]}'});
 await staleSite.read('sample',{repliesQuery:{docId:SITE_DOC}});await staleSite.read('sample',{repliesQuery:{docId:SITE_DOC}});
 assert.equal(staleSite.lookups.length,1,'a refused site id does not make the tab look again within the hour');
});
