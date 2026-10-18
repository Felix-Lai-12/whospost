import test from 'node:test';
import assert from 'node:assert/strict';
import {createApifyRunner} from '../../server/providers/apify.mjs';
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
 assert.match(calls[0].url,/maxTotalChargeUsd=0.15/);assert.ok(calls.every(x=>!x.url.includes('SECRET')));assert.equal(states[0].jobs.posts.dispatched,true);assert.equal(states[1].jobs.posts.runId,'run1');assert.deepEqual(reserves,[['s:posts',.15]]);assert.deepEqual(settles,[['s:posts',.05,{final:true}]]);
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
 const result=await fetchAccount('target',{settlePollMs:0,fetchImpl,budget:{reserve:()=>{},settle:()=>{}}});
 assert.equal(result.posts.length,5);assert.equal(result.comments.length,1);assert.equal(result.commentsAvailable,true);assert.equal(result.comparison[0].author,'other');assert.equal(result.comparedTargetIds.length,5);assert.equal(result.vocabularyEntries.length,374);assert.deepEqual(caps,[.1,.2,.3,.2]);assert.ok(caps.reduce((a,b)=>a+b,0)<1);assert.equal(inputs[2].searchQueries.length,5);assert.equal(inputs[2].maxPosts,10);delete process.env.APIFY_TOKEN;
});

test('pending jobs propagate instead of being cached as completed empty results',async()=>{
 const prior=process.env.APIFY_TOKEN;process.env.APIFY_TOKEN='fixture-token';
 try {
  await assert.rejects(()=>fetchAccount('tester',{settlePollMs:0,state:{scanId:'pending',jobs:{posts:{runId:'existing',dispatched:true}}},budget:{reserve(){},settle(){}},maxPolls:0,fetchImpl:async()=>new Response(JSON.stringify({data:{id:'existing',status:'RUNNING'}}),{status:200})}),{code:'APIFY_PENDING'});
 } finally {if(prior===undefined)delete process.env.APIFY_TOKEN;else process.env.APIFY_TOKEN=prior;}
});

test('supplemental posts reject wrong author and replies, preserve quote exclusion',async()=>{
 const {normalizeSupplementPost,relaxedTargets}=await import('../../server/providers/normalize.mjs');
 const row={record_type:'post',id:'p',username:'target',text:'Heptabase 是這次功能開發用來驗證文字檢索的足夠長內容',posted_at:'2026-10-17T00:00:00Z',url:'https://www.threads.com/@target/post/p',is_reply:false,quoted_post_url:null};
 assert.equal(normalizeSupplementPost({...row,username:'other'},'target'),null);
 assert.equal(normalizeSupplementPost({...row,is_reply:true},'target'),null);
 const p=normalizeSupplementPost(row,'target');assert.equal(p.kind,'post');assert.equal(relaxedTargets([p])[0].query,'Heptabase');assert.equal(relaxedTargets([{...p,isQuote:true}]).length,0);
});
test('runner waits for an unchanged bill before settling as final',async()=>{
 const settles=[];let reads=0;const bills=[.00005,.06005,.06005];
 const fetchImpl=async(url,init)=>{if(init?.method==='POST')return json({data:{id:'r',status:'SUCCEEDED',defaultDatasetId:'d',usageTotalUsd:.00005}});if(url.includes('/actor-runs/'))return json({data:{id:'r',status:'SUCCEEDED',defaultDatasetId:'d',usageTotalUsd:bills[Math.min(reads++,bills.length-1)]}});return json([]);};
 await createApifyRunner({token:'t',fetchImpl,sleep:async()=>{},state:{scanId:'s'},budget:{reserve(){},settle:(...x)=>settles.push(x)}})('posts','a/b',{},.10);
 assert.deepEqual(settles,[['s:posts',.06005,{final:true}]]);
 const counted=[];let n=0;const lagging=async(url,init)=>{if(init?.method==='POST')return json({data:{id:'r',status:'SUCCEEDED',defaultDatasetId:'d'}});if(url.includes('/actor-runs/'))return json({data:{id:'r',status:'SUCCEEDED',defaultDatasetId:'d',usageTotalUsd:.02,chargedEventCounts:{'apify-default-dataset-item':++n<3?10:30}}});return json(Array(30).fill({}));};
 await createApifyRunner({token:'t',fetchImpl:lagging,sleep:async()=>{},state:{scanId:'s'},budget:{reserve(){},settle:(...x)=>counted.push(x)}})('posts','a/b',{},.10);
 assert.equal(counted[0][2].final,true);assert.ok(n>=4);
 const flapping=async(url,init)=>{if(init?.method==='POST')return json({data:{id:'r',status:'SUCCEEDED',defaultDatasetId:'d',usageTotalUsd:0}});if(url.includes('/actor-runs/'))return json({data:{id:'r',status:'SUCCEEDED',defaultDatasetId:'d',usageTotalUsd:++reads/100}});return json([]);};
 const late=[];await createApifyRunner({token:'t',fetchImpl:flapping,sleep:async()=>{},settleChecks:3,state:{scanId:'s'},budget:{reserve(){},settle:(...x)=>late.push(x)}})('posts','a/b',{},.10);
 assert.equal(late[0][2].final,false);
});
