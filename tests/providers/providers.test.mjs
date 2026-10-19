import test from 'node:test';
import assert from 'node:assert/strict';
import {createApifyRunner,settleBills} from '../../server/providers/apify.mjs';
import {Store} from '../../server/store.mjs';
import {normalizeAutomation,normalizeAuthoredReply,searchTargets} from '../../server/providers/normalize.mjs';
import {fetchFactChecks} from '../../server/providers/cofacts.mjs';
import {fetchAccount} from '../../server/providers/index.mjs';
const json = value => new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
const auto=(id='1',author='target')=>({type:'post',postId:id,username:author,text:'這是一篇有足夠長度可以進行公開搜尋比對的測試文字'+id,date:'2026-01-01T00:00:00Z',url:`https://www.threads.com/@${author}/post/${id}`,isReply:false});
test('normalization excludes another author from authored replies and preserves parent context',()=>{
 const row={record_type:'reply',id:'2',username:'target',is_reply:true,text:'文字',posted_at:'2026-01-01T00:00:00Z',url:'https://www.threads.com/@target/post/2',reply_to_url:'https://www.threads.com/@other/post/1',reply_to_author:'other'};
 assert.equal(normalizeAuthoredReply({...row,username:'another'},'target'),null);
 assert.equal(normalizeAuthoredReply(row,'target').parentAuthor,'other');
 assert.equal(normalizeAuthoredReply({...row,url:'javascript:alert(1)'},'target'),null);
 assert.equal(normalizeAutomation({type:'profile'}),null);
});
test('search input caps at five target originals, excludes quotes/replies',()=>{
 const rows=Array.from({length:10},(_,i)=>normalizeAutomation(auto(String(i)))); rows[0].isQuote=true;rows[1].isReply=true;
 assert.equal(searchTargets(rows).length,5);assert.equal(searchTargets(rows)[0].id,'2');
});
test('runner sends charge cap, stores run ID before polling and does not send token in URL',async()=>{
 const calls=[],states=[],reserves=[],settles=[];
 const fetchImpl=async(url,init)=>{calls.push({url,init});if(init.method==='POST')return json({data:{id:'run1',status:'RUNNING',defaultDatasetId:'d1'}}); if(url.includes('/actor-runs/'))return json({data:{id:'run1',status:'SUCCEEDED',defaultDatasetId:'d1',usageTotalUsd:.05}});return json([auto()]);};
 const run=createApifyRunner({token:'SECRET',fetchImpl,sleep:async()=>{},onState:s=>states.push(s),state:{scanId:'s'},budget:{reserve:(...x)=>reserves.push(x),settle:(...x)=>settles.push(x)}});
 assert.equal((await run('posts','automation-lab/threads-scraper',{maxPosts:10},.15)).length,1);
 assert.match(calls[0].url,/maxTotalChargeUsd=0.15/);assert.ok(calls.every(x=>!x.url.includes('SECRET')));assert.equal(states[0].jobs.posts.dispatched,true);assert.equal(states[1].jobs.posts.runId,'run1');assert.deepEqual(reserves,[['s:posts',.15]]);
 assert.deepEqual(settles,[],'the bill settles after the rows are returned');assert.equal(states.at(-1).jobs.posts.rowCount,1);
});
test('runner uses manual redirects, which Workers accept, and refuses a redirect instead of following it',async()=>{
 const inits=[];const fetchImpl=async(url,init)=>{inits.push(init);return new Response(null,{status:302,headers:{Location:'https://elsewhere.example/'}});};
 await assert.rejects(createApifyRunner({token:'s',state:{scanId:'s'},fetchImpl,budget:{reserve:()=>{},settle:()=>{}}})('posts','a/b',{},.15),{code:'APIFY_HTTP'});
 assert.ok(inits.length===1&&inits.every(i=>i.redirect==='manual'));
});
test('a 4xx answer to the start request releases the reservation and the retry is reserved under a new key',async()=>{
 let state,fail=true;const reserves=[],settles=[];
 const fetchImpl=async(url,init)=>{if(init.method==='POST'){if(fail)return new Response('{}',{status:402});return json({data:{id:'run1',status:'SUCCEEDED',defaultDatasetId:'d1',usageTotalUsd:.05}});}if(url.includes('/actor-runs/'))return json({data:{id:'run1',status:'SUCCEEDED',defaultDatasetId:'d1',usageTotalUsd:.05}});return json([auto()]);};
 const options={token:'s',fetchImpl,sleep:async()=>{},onState:s=>state=s,budget:{reserve:(...x)=>reserves.push(x),settle:(...x)=>settles.push(x)}};
 await assert.rejects(createApifyRunner({...options,state:{scanId:'s'}})('posts','a/b',{},.15),{code:'APIFY_HTTP',status:402});
 assert.deepEqual(settles,[['s:posts',0,{final:true}]]);assert.equal(state.jobs.posts,undefined);assert.equal(state.releases.posts,1);
 fail=false;assert.equal((await createApifyRunner({...options,state})('posts','a/b',{},.15)).length,1);
 assert.deepEqual(reserves,[['s:posts',.15],['s:posts:retry1',.15]]);assert.equal(state.jobs.posts.reservedKey,'s:posts:retry1');
 for(const pending of [true,false])assert.equal(await settleBills(state,{token:'s',fetchImpl,budget:options.budget,onState:s=>state=s}),pending);
 assert.deepEqual(settles,[['s:posts',0,{final:true}],['s:posts:retry1',.05,{final:true}]]);
});
test('a 5xx answer to the start request keeps the reservation and blocks automatic resend',async()=>{
 let state,starts=0;const options={token:'s',state:{scanId:'s'},fetchImpl:async()=>{starts++;return new Response('{}',{status:503});},onState:s=>state=s,budget:{reserve:()=>{},settle:()=>{throw Error('must not settle');}}};
 await assert.rejects(createApifyRunner(options)('posts','a/b',{},.15),{code:'APIFY_HTTP',status:503});
 await assert.rejects(createApifyRunner({...options,state})('posts','a/b',{},.15),{code:'APIFY_UNKNOWN_RUN'});assert.equal(starts,1);
});
test('unknown POST outcome remains reserved and cannot automatically dispatch again',async()=>{
 let state,starts=0;const options={token:'s',state:{scanId:'s'},fetchImpl:async()=>{starts++;throw Error('network');},onState:s=>state=s,budget:{reserve:()=>{},settle:()=>{throw Error('must not settle');}}};
 await assert.rejects(createApifyRunner(options)('posts','a/b',{},.15),{code:'APIFY_NETWORK'});
 await assert.rejects(createApifyRunner({...options,state})('posts','a/b',{},.15),{code:'APIFY_UNKNOWN_RUN'});assert.equal(starts,1);
});
test('existing successful run retrieves dataset without launching another paid job',async()=>{
 let starts=0;const run=createApifyRunner({token:'s',state:{scanId:'s',jobs:{posts:{runId:'run1',dispatched:true,reservedKey:'s:posts'}}},budget:{reserve:()=>{throw Error('duplicate reserve');},settle:()=>{}},fetchImpl:async(url,init)=>{if(init.method==='POST')starts++;return url.includes('/actor-runs/')?json({data:{id:'run1',status:'SUCCEEDED',defaultDatasetId:'d1',usageTotalUsd:.02}}):json([]);}});
 assert.deepEqual(await run('posts','a/b',{},.15),[]);assert.equal(starts,0);
});
test('Cofacts returns attribution and query source, distinguishes no-match from error',async()=>{
 const posts=[{...normalizeAutomation(auto()),text:'政府宣布2026年10月17日發放補助，每人可領取1000元。'}];const empty=await fetchFactChecks(posts,{fetchImpl:async()=>json({data:{ListArticles:{edges:[]}}})});assert.equal(empty.status,'no_match');assert.equal(empty.sourcePostId,'1');assert.equal(empty.license,'CC BY-SA 4.0');
 const failed=await fetchFactChecks(posts,{fetchImpl:async()=>json({errors:[{message:'failure'}]})});assert.equal(failed.status,'error');
});
test('full bundle accepts only target posts and authored replies, bounded fallback jobs stay below one dollar',async()=>{
 process.env.APIFY_TOKEN='fixture';let n=0;const inputs=[],caps=[];const datasets={};
 const fetchImpl=async(url,init={})=>{
  if(url.includes('cofacts'))return json({data:{ListArticles:{edges:[]}}});
  if(init.method==='POST'){const input=JSON.parse(init.body);inputs.push(input);caps.push(Number(new URL(url).searchParams.get('maxTotalChargeUsd')));const id=String(++n);datasets[id]=input.mode==='posts'?[...Array.from({length:5},(_,i)=>({record_type:'post',id:String(i),username:'target',text:auto(String(i)).text,posted_at:'2026-01-01T00:00:00Z',url:auto(String(i)).url})),{record_type:'post',id:'wrong',username:'another',text:'wrong',url:'https://www.threads.com/@another/post/wrong'}]:input.mode==='replies'?[{record_type:'reply',id:'r',username:'target',is_reply:true,text:'reply',posted_at:'2026-01-01',url:'https://www.threads.com/@target/post/r',reply_to_url:'https://www.threads.com/@other/post/o',reply_to_author:'other'}]:[auto('c','other')];return json({data:{id,status:'SUCCEEDED',defaultDatasetId:id,usageTotalUsd:.01}});}
  return json(datasets[url.match(/datasets\/(\d+)/)[1]]);
 };
 const result=await fetchAccount('target',{fetchImpl,budget:{reserve:()=>{},settle:()=>{}}});
 assert.equal(result.posts.length,5);assert.equal(result.comments.length,1);assert.equal(result.commentsAvailable,true);assert.equal(result.comparison[0].author,'other');assert.equal(result.comparedTargetIds.length,5);assert.equal(result.vocabularyEntries.length,374);assert.deepEqual(caps,[.1,.2,.3,.2]);assert.ok(caps.reduce((a,b)=>a+b,0)<1);assert.equal(inputs[2].searchQueries.length,5);assert.equal(inputs[2].maxPosts,10);delete process.env.APIFY_TOKEN;
});

test('pending jobs propagate instead of being cached as completed empty results',async()=>{
 const prior=process.env.APIFY_TOKEN;process.env.APIFY_TOKEN='fixture-token';
 try {
  await assert.rejects(()=>fetchAccount('tester',{state:{scanId:'pending',jobs:{posts:{runId:'existing',dispatched:true}}},budget:{reserve(){},settle(){}},maxPolls:0,fetchImpl:async()=>new Response(JSON.stringify({data:{id:'existing',status:'RUNNING'}}),{status:200})}),{code:'APIFY_PENDING'});
 } finally {if(prior===undefined)delete process.env.APIFY_TOKEN;else process.env.APIFY_TOKEN=prior;}
});

test('supplemental posts reject wrong author and replies, preserve quote exclusion',async()=>{
 const {normalizeSupplementPost,relaxedTargets}=await import('../../server/providers/normalize.mjs');
 const row={record_type:'post',id:'p',username:'target',text:'Heptabase 是這次功能開發用來驗證文字檢索的足夠長內容',posted_at:'2026-10-17T00:00:00Z',url:'https://www.threads.com/@target/post/p',is_reply:false,quoted_post_url:null};
 assert.equal(normalizeSupplementPost({...row,username:'other'},'target'),null);
 assert.equal(normalizeSupplementPost({...row,is_reply:true},'target'),null);
 const p=normalizeSupplementPost(row,'target');assert.equal(p.kind,'post');assert.equal(relaxedTargets([p])[0].query,'Heptabase');assert.equal(relaxedTargets([{...p,isQuote:true}]).length,0);
});
const finished=(extra={})=>({scanId:'s',jobs:{posts:{runId:'r',reservedKey:'s:posts',status:'SUCCEEDED',rowCount:0,...extra}}});
// Runs settlement passes the way a host does, with each pass's saved state feeding the next. Returns each pass's answer.
async function passes(state,options,max=10){const answers=[];let current=state;for(let i=0;i<max;i++){const pending=await settleBills(current,{token:'t',...options,onState:s=>{current=s;options.onState?.(s);}});answers.push(pending);if(!pending)break;}return {answers,state:current};}
test('settlement waits for an unchanged bill and dataset-item charges that cover the rows returned',async()=>{
 const settles=[];let reads=0;const bills=[.00005,.06005,.06005];
 const fetchImpl=async()=>json({data:{id:'r',status:'SUCCEEDED',usageTotalUsd:bills[Math.min(reads++,bills.length-1)]}});
 const steady=await passes(finished(),{fetchImpl,budget:{settle:(...x)=>settles.push(x)}});
 assert.deepEqual(steady.answers,[true,true,false]);assert.deepEqual(settles,[['s:posts',.06005,{final:true}]]);
 assert.equal(steady.state.jobs.posts.usageFinal,true);assert.equal(steady.state.jobs.posts.usageTotalUsd,.06005);
 const counted=[];let n=0;const lagging=async()=>json({data:{id:'r',status:'SUCCEEDED',usageTotalUsd:.02,chargedEventCounts:{'apify-default-dataset-item':++n<3?10:30}}});
 await passes(finished({rowCount:30}),{fetchImpl:lagging,budget:{settle:(...x)=>counted.push(x)}});
 assert.deepEqual(counted,[['s:posts',.02,{final:true}]]);assert.equal(n,4,'two equal reads that cover all 30 rows');
 let cents=0;const flapping=async()=>json({data:{id:'r',status:'SUCCEEDED',usageTotalUsd:++cents/100}});
 const late=[];const gaveUp=await passes(finished(),{fetchImpl:flapping,settleChecks:3,budget:{settle:(...x)=>late.push(x)}});
 assert.deepEqual(gaveUp.answers,[true,true,false]);assert.deepEqual(late,[['s:posts',.03,{final:false}]],'a provisional bill still counts at the cap');
 assert.equal(gaveUp.state.jobs.posts.usageFinal,false);
});
test('a failed bill read counts as a check, and the next good read still pairs with the earlier one',async()=>{
 const settles=[];let n=0;const fetchImpl=async()=>++n===2?new Response('{}',{status:503}):json({data:{id:'r',status:'SUCCEEDED',usageTotalUsd:.04}});
 const result=await passes(finished(),{fetchImpl,budget:{settle:(...x)=>settles.push(x)}});
 assert.deepEqual(result.answers,[true,true,false]);assert.equal(result.state.jobs.posts.billChecks,3);assert.deepEqual(settles,[['s:posts',.04,{final:true}]]);
 const none=[];const down=await passes(finished(),{fetchImpl:async()=>{throw Error('offline');},settleChecks:2,budget:{settle:(...x)=>none.push(x)}});
 assert.deepEqual(down.answers,[true,false]);assert.deepEqual(none,[],'with no bill ever read, the reservation stays at its cap');
});
test('only finished runs whose rows went back are settled; a final bill is never read or settled again',async()=>{
 const urls=[],settles=[];const fetchImpl=async url=>{urls.push(url);return json({data:{status:'SUCCEEDED',usageTotalUsd:.01}});};
 const state={scanId:'s',jobs:{
  running:{runId:'a',reservedKey:'s:running',status:'RUNNING'},
  noRows:{runId:'b',reservedKey:'s:noRows',status:'SUCCEEDED'},
  unknown:{dispatched:true,reservedKey:'s:unknown',status:'DISPATCHING'},
  done:{runId:'c',reservedKey:'s:done',status:'SUCCEEDED',rowCount:3,usageTotalUsd:.02,usageFinal:true},
  failed:{runId:'d',reservedKey:'s:failed',status:'FAILED',rowCount:null}}};
 const result=await passes(state,{fetchImpl,budget:{settle:(...x)=>settles.push(x)}});
 assert.deepEqual(result.answers,[true,false]);assert.ok(urls.every(u=>u.endsWith('/actor-runs/d')));assert.deepEqual(settles,[['s:failed',.01,{final:true}]]);
 assert.deepEqual(result.state.jobs.done,state.jobs.done);
});
test('rows return before any bill read; the ledger counts the cap until a later pass settles, also across a crash',async()=>{
 const store=new Store(':memory:',{budgetLimitUsd:1}),scan=store.create('tester'),urls=[];
 const fetchImpl=async(url,init)=>{urls.push(url);if(init?.method==='POST')return json({data:{id:'run1',status:'RUNNING',defaultDatasetId:'d1'}});if(url.includes('/actor-runs/'))return json({data:{id:'run1',status:'SUCCEEDED',defaultDatasetId:'d1',usageTotalUsd:.05}});return json([auto(),auto('2')]);};
 const host={budget:store.budget,onState:s=>store.setState(scan.id,s)};
 const rows=await createApifyRunner({token:'t',fetchImpl,sleep:async()=>{},state:store.getState(scan.id),...host})('posts','a/b',{},.15);
 assert.equal(rows.length,2);assert.deepEqual(urls.map(u=>u.replace(/\?.*/,'').split('/').slice(-2,-1)[0]),['a~b','actor-runs','d1'],'start, one poll, dataset: no bill read');
 assert.equal(store.budget.summary().committed,.15,'unsettled reservation counts at its cap');
 // The host dies here, before any settlement: nothing is released. A later pass picks the job up from the saved state.
 assert.equal(await settleBills(store.getState(scan.id),{token:'t',fetchImpl,...host}),true);
 assert.equal(store.budget.summary().committed,.15,'one read is not a final bill');
 // A crash between the saved state and the ledger write leaves the cap counted, and the job is not settled twice.
 const crashing={...host,budget:{settle:()=>{throw Error('host stopped');}}};
 await assert.rejects(()=>settleBills(store.getState(scan.id),{token:'t',fetchImpl,...crashing}),/host stopped/);
 assert.equal(store.getState(scan.id).jobs.posts.usageFinal,true);assert.equal(store.budget.summary().committed,.15);
 const reads=urls.length;assert.equal(await settleBills(store.getState(scan.id),{token:'t',fetchImpl,...host}),false);assert.equal(urls.length,reads);
 assert.equal(store.budget.summary().committed,.15);
 // Without the crash the second pass books the final bill and releases the unused part.
 const fresh=store.create('other');store.budget.reserve(`${fresh.id}:posts`,.15);
 store.setState(fresh.id,{jobs:{posts:{runId:'run1',reservedKey:`${fresh.id}:posts`,status:'SUCCEEDED',rowCount:2}}});
 const freshHost={budget:store.budget,onState:s=>store.setState(fresh.id,s)};
 assert.equal(await settleBills(store.getState(fresh.id),{token:'t',fetchImpl,...freshHost}),true);
 assert.equal(await settleBills(store.getState(fresh.id),{token:'t',fetchImpl,...freshHost}),false);
 assert.equal(store.budget.summary().committed,Number((.15+.05).toFixed(6)));
 store.close();
});

test('resuming a job whose bill is already final reads the run and rows only, without settling again',async()=>{
 const urls=[],settles=[];
 const fetchImpl=async url=>{urls.push(url);return {ok:true,json:async()=>url.includes('/datasets/')?[{id:'row'}]:{data:{id:'r1',status:'SUCCEEDED',defaultDatasetId:'d1',usageTotalUsd:.06}}};};
 const run=createApifyRunner({token:'SECRET',fetchImpl,sleep:async()=>{},state:{scanId:'s',jobs:{posts:{runId:'r1',reservedKey:'s:posts',usageTotalUsd:.06,usageFinal:true,status:'SUCCEEDED'}}},budget:{reserve:()=>{throw Error('must not reserve');},settle:(...x)=>settles.push(x)}});
 assert.deepEqual(await run('posts','a/b',{},.15),[{id:'row'}]);
 assert.equal(urls.length,2);assert.deepEqual(settles,[]);
});
