import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fetchAccount} from '../../server/providers/index.mjs';
import {normalizeSupplementPost,normalizeAuthoredReply} from '../../server/providers/normalize.mjs';
const PRIMARY='benthepythondev/threads-user-posts-scraper';
const long='這是一篇有足夠長度的公開技術教學分享內容以及安裝方式說明歡迎參考';
const post=(id,extra={})=>({record_type:'post',id:String(id),username:'tester',text:long+id,url:`https://www.threads.com/@tester/post/${id}`,posted_at:'2026-10-17T00:00:00Z',is_reply:false,...extra});
const reply=id=>({...post(id),record_type:'reply',is_reply:true,reply_to_url:'https://www.threads.com/@other/post/parent',reply_to_author:'other'});
const auto=id=>({type:'post',postId:id,username:'tester',text:'短文',date:'2026-10-17T00:00:00Z',url:`https://www.threads.com/@tester/post/${id}`});
const json=data=>new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});
async function fixture(fn){const prior=process.env.APIFY_TOKEN;process.env.APIFY_TOKEN='test-fixture-only';try{return await fn();}finally{if(prior===undefined)delete process.env.APIFY_TOKEN;else process.env.APIFY_TOKEN=prior;}}
function mock({rows=()=>[],saved={}}={}){
 const calls=[],datasets={...saved};let n=0;
 return {calls,fetchImpl:async(url,init={})=>{
  if(url.includes('cofacts'))return json({data:{ListArticles:{edges:[]}}});
  if(init.method==='POST'){
   const input=JSON.parse(init.body);const id=`new-${++n}`;
   calls.push({actor:url.includes('benthepythondev~')?PRIMARY:'automation-lab/threads-scraper',input,cap:Number(new URL(url).searchParams.get('maxTotalChargeUsd'))});
   datasets[id]=rows(input);return json({data:{id,status:'SUCCEEDED',defaultDatasetId:id,usageTotalUsd:.01}});
  }
  if(url.includes('/actor-runs/')){const id=decodeURIComponent(url.split('/').pop());return json({data:{id,status:'SUCCEEDED',defaultDatasetId:id,usageTotalUsd:.01}});}
  const id=url.match(/datasets\/([^/]+)/)?.[1];assert.ok(id in datasets,`unexpected dataset ${id}`);return json(datasets[id]);
 }};
}
const budget={reserve(){},settle(){}};

test('new scan sends exactly one primary posts and one replies job, bounded search only on automation',()=>fixture(async()=>{
 const transport=mock({rows:input=>input.mode==='posts'?Array.from({length:12},(_,i)=>post(i+1)):input.mode==='replies'?Array.from({length:55},(_,i)=>reply(i+1)):[{...auto('c1'),username:'other1',url:'https://www.threads.com/@other1/post/c1'},{...auto('c2'),username:'other2',url:'https://www.threads.com/@other2/post/c2'}]});
 let finalState;
 const result=await fetchAccount('tester',{settlePollMs:0,state:{scanId:'new',marker:'preserve'},budget,fetchImpl:transport.fetchImpl,onState:s=>{finalState=s;}});
 assert.equal(result.posts.length,10);assert.equal(result.comments.length,50);
 assert.deepEqual(transport.calls.map(c=>[c.actor,c.input.mode,c.cap]),[[PRIMARY,'posts',.10],[PRIMARY,'replies',.20],['automation-lab/threads-scraper','search',.30]]);
 assert.equal(transport.calls[0].input.maxResults,10);assert.equal(transport.calls[1].input.maxResults,50);
 assert.ok(transport.calls[2].input.searchQueries.length<=5);assert.equal(transport.calls[2].input.maxPosts,10);
 assert.equal(finalState.jobs.posts.actor,PRIMARY);assert.equal(finalState.marker,'preserve');assert.equal(finalState.jobs.postsSupplement,undefined);
}));

test('empty primary dataset does not trigger duplicate supplemental capture or automation posts',()=>fixture(async()=>{
 const transport=mock();const result=await fetchAccount('tester',{settlePollMs:0,state:{scanId:'empty'},budget,fetchImpl:transport.fetchImpl});
 assert.equal(result.posts.length,0);assert.deepEqual(transport.calls.map(c=>[c.actor,c.input.mode]),[[PRIMARY,'posts'],[PRIMARY,'replies']]);
}));

test('legacy automation posts and existing supplement resume by original keys without any new dispatch',()=>fixture(async()=>{
 const state={scanId:'legacy',marker:'keep',jobs:{posts:{actor:'automation-lab/threads-scraper',runId:'old-posts',dispatched:true,reservedKey:'legacy:posts'},postsSupplement:{actor:PRIMARY,runId:'old-extra',dispatched:true,reservedKey:'legacy:postsSupplement'},replies:{actor:PRIMARY,runId:'old-replies',dispatched:true,reservedKey:'legacy:replies'}}};
 const unchanged=structuredClone(state),states=[];
 const transport=mock({saved:{'old-posts':[auto('same')],'old-extra':[post('same',{text:'短文'}),post('extra',{text:'另一個短文'})],'old-replies':[]}});
 const result=await fetchAccount('tester',{settlePollMs:0,state,budget:{reserve(){throw Error('must not reserve');},settle(){}},fetchImpl:transport.fetchImpl,onState:s=>states.push(s)});
 assert.deepEqual(transport.calls,[]);assert.equal(result.posts.length,2);assert.deepEqual(state,unchanged);
 assert.ok(states.every(s=>s.marker==='keep'&&s.jobs.posts.runId==='old-posts'&&s.jobs.postsSupplement.runId==='old-extra'));
}));

test('legacy automation-only scan without actor metadata resumes without adding primary or supplement',()=>fixture(async()=>{
 const transport=mock({saved:{old:[auto('one')],replies:[]}});
 const result=await fetchAccount('tester',{settlePollMs:0,state:{scanId:'legacy',jobs:{posts:{runId:'old',dispatched:true},replies:{runId:'replies',dispatched:true}}},budget:{reserve(){throw Error('must not reserve');},settle(){}},fetchImpl:transport.fetchImpl});
 assert.equal(result.posts[0].source,'automation-lab/threads-scraper');assert.equal(transport.calls.length,0);
}));

test('saved supplement-only or new-primary job restores without launching replacement posts',()=>fixture(async()=>{
 for(const key of ['postsSupplement','posts']){
  const transport=mock({saved:{old:[post('one',{text:'短文'})],replies:[]}});
  const result=await fetchAccount('tester',{settlePollMs:0,state:{scanId:'saved',jobs:{[key]:{actor:PRIMARY,runId:'old',dispatched:true},replies:{runId:'replies',dispatched:true}}},budget:{reserve(){throw Error('must not reserve');},settle(){}},fetchImpl:transport.fetchImpl});
  assert.equal(result.posts.length,1);assert.equal(result.posts[0].source,PRIMARY);assert.equal(transport.calls.length,0);
 }
}));

test('unknown legacy dispatch remains unknown and never launches a replacement',()=>fixture(async()=>{
 const transport=mock();await assert.rejects(()=>fetchAccount('tester',{settlePollMs:0,state:{scanId:'unknown',jobs:{posts:{dispatched:true,actor:'automation-lab/threads-scraper'}}},budget,fetchImpl:transport.fetchImpl}),{code:'APIFY_UNKNOWN_RUN'});
 assert.equal(transport.calls.length,0);
}));

const saved=JSON.parse(readFileSync(new URL('./fixtures/provider-accounts.json',import.meta.url),'utf8'));
test('both synthetic bundles retain benthe posts/replies required field and parent normalization contracts',()=>{
 assert.equal(saved.records.length,2);
 for(const item of saved.records){const {account,posts,comments}=item.bundle;
  assert.ok(posts.length<=10&&comments.length<=50);assert.equal(item.label,null);
  // Adapter checks only: these are synthetic records, not a new fetch or raw provider replay.
  for(const p of posts){assert.equal(p.source,PRIMARY);const normalized=normalizeSupplementPost({record_type:'post',id:p.id,username:p.author,text:p.text,posted_at:p.postedAt,url:p.url,is_reply:false,quoted_post_url:p.isQuote?'https://www.threads.com/@example/post/quoted':null,reposted_by:p.isRepost?'fixture':null},account.username);assert.ok(normalized);for(const field of ['id','author','text','postedAt','url','isQuote','isRepost'])assert.equal(normalized[field],p[field]);}
  for(const p of comments){const normalized=normalizeAuthoredReply({record_type:'reply',id:p.id,username:p.author,text:p.text,posted_at:p.postedAt,url:p.url,is_reply:true,reply_to_author:p.parentAuthor,reply_to_url:p.parentUrl,quoted_post_url:p.isQuote?'https://www.threads.com/@example/post/quoted':null,reposted_by:p.isRepost?'fixture':null},account.username);assert.ok(normalized);for(const field of ['id','author','text','postedAt','url','parentUrl','parentAuthor','isQuote','isRepost'])assert.equal(normalized[field],p[field]);}
 }
});

test('cross-account search switch off sends only posts and replies jobs',()=>fixture(async()=>{
 const transport=mock({rows:input=>input.mode==='posts'?Array.from({length:12},(_,i)=>post(i+1)):input.mode==='replies'?Array.from({length:5},(_,i)=>reply(i+1)):assert.fail('search must not run')});
 const result=await fetchAccount('tester',{settlePollMs:0,crossAccountSearch:false,state:{scanId:'off'},budget,fetchImpl:transport.fetchImpl});
 assert.deepEqual(transport.calls.map(c=>c.input.mode),['posts','replies']);
 assert.ok(result.limitations.some(l=>l.includes('跨帳號搜尋已關閉')));
}));

// Apify double for concurrency: runs stay RUNNING while `running(mode)` says so, and `reject(mode)` answers the start with that HTTP status.
function liveMock({running=()=>false,reject=()=>null}={}){
 const events=[],modes={};let n=0;
 return {events,fetchImpl:async(url,init={})=>{
  if(url.includes('cofacts'))return json({data:{ListArticles:{edges:[]}}});
  if(init.method==='POST'){const {mode}=JSON.parse(init.body);events.push(`start:${mode}`);const status=reject(mode);if(status)return new Response('{}',{status});const id=`${mode}-${++n}`;modes[id]=mode;return json({data:{id,status:'RUNNING',defaultDatasetId:id}});}
  if(url.includes('/actor-runs/')){const id=decodeURIComponent(url.split('/').pop());events.push(`poll:${modes[id]}`);return json({data:{id,status:running(modes[id])?'RUNNING':'SUCCEEDED',defaultDatasetId:id,usageTotalUsd:.01}});}
  const id=url.match(/datasets\/([^/]+)/)[1];return json(modes[id]==='posts'?[post(1)]:[reply(1)]);
 }};
}

test('posts and replies jobs start together instead of one after the other',()=>fixture(async()=>{
 const transport=liveMock(),progress=[];
 const result=await fetchAccount('tester',{pollMs:0,settlePollMs:0,crossAccountSearch:false,state:{scanId:'both'},budget,fetchImpl:transport.fetchImpl,onProgress:p=>progress.push(p)});
 assert.deepEqual(transport.events.slice(0,2),['start:posts','start:replies']);
 assert.equal(result.posts.length,1);assert.equal(result.comments.length,1);
 assert.deepEqual(result.collection.steps.map(s=>[s.key,s.status]),[['posts','succeeded'],['replies','succeeded']]);
 assert.ok(result.limitations.findIndex(l=>l.includes('則發文'))<result.limitations.findIndex(l=>l.includes('則本人留言')));
 assert.equal(progress[0],'同時讀取最近 10 則發文與最多 50 則本人留言');
}));

test('concurrent job state writes land in the order they were made',()=>fixture(async()=>{
 const transport=mock({rows:input=>input.mode==='posts'?[post(1)]:[reply(1)]}),landed=[];let writes=0;
 // The first write is the slowest; without a queue it would land last and drop both run IDs.
 const onState=async s=>{const slow=writes++===0;await new Promise(r=>setTimeout(r,slow?20:0));landed.push(s);};
 await fetchAccount('tester',{settlePollMs:0,crossAccountSearch:false,state:{scanId:'order'},budget,fetchImpl:transport.fetchImpl,onState});
 const last=landed.at(-1);
 assert.equal(last.jobs.posts.runId,'new-1');assert.equal(last.jobs.replies.runId,'new-2');
 assert.equal(last.jobs.posts.usageFinal,true);assert.equal(last.jobs.replies.usageFinal,true);
}));

test('a still-running job is reported as pending even when the other job failed outright',()=>fixture(async()=>{
 const transport=liveMock({running:mode=>mode==='replies',reject:mode=>mode==='posts'?401:null});let saved;
 await assert.rejects(()=>fetchAccount('tester',{pollMs:0,maxPolls:1,settlePollMs:0,crossAccountSearch:false,state:{scanId:'pending'},budget,fetchImpl:transport.fetchImpl,onState:s=>{saved=s;}}),{code:'APIFY_PENDING'});
 assert.equal(saved.jobs.replies.runId,'replies-1');assert.equal(saved.jobs.posts,undefined);
}));

test('an unconfirmed dispatch blocks new paid jobs, while a saved run still finishes and settles',()=>fixture(async()=>{
 const blank=mock();
 await assert.rejects(()=>fetchAccount('tester',{settlePollMs:0,state:{scanId:'u1',jobs:{replies:{dispatched:true,actor:PRIMARY}}},budget,fetchImpl:blank.fetchImpl}),{code:'APIFY_UNKNOWN_RUN'});
 assert.equal(blank.calls.length,0);
 const resumed=mock({saved:{'saved-posts':[post(1)]}}),settled=[];
 await assert.rejects(()=>fetchAccount('tester',{settlePollMs:0,state:{scanId:'u2',jobs:{posts:{actor:PRIMARY,runId:'saved-posts',dispatched:true,reservedKey:'u2:posts'},replies:{dispatched:true,actor:PRIMARY}}},budget:{reserve(){throw Error('must not reserve');},settle(key){settled.push(key);}},fetchImpl:resumed.fetchImpl}),{code:'APIFY_UNKNOWN_RUN'});
 assert.equal(resumed.calls.length,0);assert.deepEqual(settled,['u2:posts']);
}));
