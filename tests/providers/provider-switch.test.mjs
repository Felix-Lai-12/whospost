import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchAccount,BROWSER_CAP_USD} from '../../server/providers/index.mjs';
import {ProviderError} from '../../server/providers/apify.mjs';
import {setLogSink} from '../../worker/log.mjs';
const PRIMARY='benthepythondev/threads-user-posts-scraper';
const json=data=>new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});
const row=(id,kind='post')=>({id:String(id),author:'hkj315',kind,text:`文字 ${id}`,postedAt:'2026-10-17T00:00:00Z',url:`https://www.threads.com/@hkj315/post/${id}`,parentUrl:kind==='post'?null:'https://www.threads.com/@hkj331155/post/p',parentAuthor:kind==='post'?null:'hkj331155',isQuote:false,isRepost:false,isReply:kind!=='post',source:'cloudflare-browser'});
const apifyPost=id=>({record_type:'post',id:String(id),username:'hkj315',text:`apify ${id}`,url:`https://www.threads.com/@hkj315/post/a${id}`,posted_at:'2026-10-17T00:00:00Z',is_reply:false});
/** A fake Apify transport that answers every job with `rows` and records the actors it started. */
function apify(rows=[apifyPost(1)]){
 const starts=[];
 return {starts,fetchImpl:async(url,init={})=>{
  if(url.includes('cofacts'))return json({data:{ListArticles:{edges:[]}}});
  if(init.method==='POST'){starts.push(url.includes('benthepythondev~')?PRIMARY:'other');return json({data:{id:'r1',status:'SUCCEEDED',defaultDatasetId:'d1',usageTotalUsd:.01}});}
  if(url.includes('/actor-runs/'))return json({data:{id:'r1',status:'SUCCEEDED',defaultDatasetId:'d1',usageTotalUsd:.01}});
  return json(rows);
 }};
}
const ledger=()=>{const reserves=[],settles=[];return {reserves,settles,budget:{reserve:(k,a)=>{reserves.push([k,a]);},settle:(k,a,o)=>{settles.push([k,a,o]);}}};};
const browserOk=async(username,{profile,onPartial})=>{onPartial({account:{name:'測試'},posts:[row(1)]});onPartial({comments:[row(2,'authored_reply')]});return {name:'測試',posts:Array.from({length:profile.posts},(_,i)=>row(i+1)),comments:[row(20,'authored_reply'),row(21,'authored_reply')],postComments:[],meta:{browserSeconds:24,pages:2,durationMs:26000}};};
const browserWall=async()=>{throw Object.assign(new ProviderError('BROWSER_WALL','牆'),{meta:{browserSeconds:6,posts:null}});};
const lines=[];const restore=setLogSink((l,line)=>lines.push(JSON.parse(line)));test.after(()=>restore());
const options=extra=>({state:{scanId:'s1'},profileId:'standard-20',crossAccountSearch:false,token:'fixture-only',...extra});
test('browser provider: rows come from the browser, Apify is never started, one ledger row is settled at once with the seconds used',async()=>{
 const {starts,fetchImpl}=apify(),{reserves,settles,budget}=ledger();
 const bundle=await fetchAccount('HKJ315',options({fetchImpl,budget,browser:browserOk}));
 assert.equal(starts.length,0);assert.equal(bundle.posts.length,10);assert.equal(bundle.comments.length,2);assert.equal(bundle.account.name,'測試');
 assert.equal(bundle.commentsAvailable,true);assert.equal(bundle.collection.provider,'browser');assert.equal(bundle.collection.status,'available');
 assert.deepEqual(bundle.collection.steps.map(s=>[s.key,s.status,s.recordCount,s.browserSeconds]),[['browser','succeeded',12,24]]);
 assert.deepEqual(reserves,[['s1:browser',BROWSER_CAP_USD]]);assert.deepEqual(settles,[['s1:browser',.0006,{final:true}]],'24 s at US$0.09/h');
 assert.ok(bundle.limitations.some(l=>l.includes('2/20')),'fewer replies than the profile asks for is a limitation, not a failure');
});
test('browser round fails with fallback apify: the browser step is recorded failed, its seconds settled, then the Apify jobs run',async()=>{
 const {starts,fetchImpl}=apify(),{reserves,settles,budget}=ledger();
 const bundle=await fetchAccount('hkj315',options({fetchImpl,budget,browser:browserWall,fallback:'apify'}));
 assert.deepEqual(starts,[PRIMARY,PRIMARY]);assert.equal(bundle.collection.provider,'apify');assert.equal(bundle.posts.length,1);assert.equal(bundle.posts[0].source,PRIMARY);
 assert.deepEqual(bundle.collection.steps.map(s=>[s.key,s.status,s.errorCode??null]),[['browser','failed','BROWSER_WALL'],['posts','succeeded',null],['replies','succeeded',null]]);
 assert.equal(bundle.collection.status,'partial','a failed step is visible in the result');
 assert.deepEqual(reserves.map(r=>r[0]),['s1:browser','s1:posts','s1:replies']);assert.deepEqual(settles[0],['s1:browser',.00015,{final:true}]);
 assert.ok(bundle.limitations.some(l=>l.includes('改用 Apify')));
 const fb=lines.find(l=>l.event==='browser.fallback');assert.equal(fb.code,'BROWSER_WALL');assert.equal(fb.scanId,'s1');
});
test('browser round fails with fallback fail: the scan fails with the BROWSER_* code and Apify is never started',async()=>{
 const {starts,fetchImpl}=apify(),{budget}=ledger();
 await assert.rejects(fetchAccount('hkj315',options({fetchImpl,budget,browser:browserWall,fallback:'fail'})),e=>e.code==='BROWSER_WALL'&&e.collection.status==='failed'&&e.collection.steps[0].errorCode==='BROWSER_WALL');
 assert.equal(starts.length,0);
});
test('fewer posts than minPosts is BROWSER_SHORT and falls back; the default minPosts of 1 lets an 8-post account through',async()=>{
 const few=async()=>({name:null,posts:Array.from({length:8},(_,i)=>row(i+1)),comments:[],postComments:[],meta:{browserSeconds:10}});
 const {starts,fetchImpl}=apify(),{budget}=ledger();
 const short=await fetchAccount('hkj315',options({fetchImpl,budget,browser:few,minPosts:9}));
 assert.equal(short.collection.provider,'apify');assert.equal(short.collection.steps[0].errorCode,'BROWSER_SHORT');assert.equal(short.collection.steps[0].recordCount,8);assert.equal(starts.length,2);
 const fine=await fetchAccount('hkj315',options({fetchImpl:apify().fetchImpl,budget,browser:few}));
 assert.equal(fine.collection.provider,'browser');assert.equal(fine.posts.length,8);assert.ok(fine.limitations.some(l=>l.includes('8/10')));
});
test('a non-browser failure in the browser path (ledger refused) is not swallowed by the fallback',async()=>{
 const budget={reserve(){throw Object.assign(new ProviderError('BUDGET_EXCEEDED','no'),{});},settle(){}};
 await assert.rejects(fetchAccount('hkj315',options({fetchImpl:apify().fetchImpl,budget,browser:browserOk})),{code:'BUDGET_EXCEEDED'});
});
test('saved Apify jobs are resumed instead of paying for a browser round; without browser the Apify path is unchanged',async()=>{
 let browserCalls=0;const browser=async()=>{browserCalls++;return browserOk();};
 const {starts,fetchImpl}=apify(),{budget}=ledger();
 const resumed=await fetchAccount('hkj315',options({fetchImpl,budget,browser,state:{scanId:'s1',jobs:{posts:{runId:'r1',dispatched:true,reservedKey:'s1:posts',actor:PRIMARY}}}}));
 assert.equal(browserCalls,0);assert.equal(resumed.collection.provider,'apify');assert.equal(starts.length,1,'only the replies job is new');
 const plain=await fetchAccount('hkj315',options({fetchImpl:apify().fetchImpl,budget}));
 assert.equal(plain.collection.provider,'apify');assert.deepEqual(plain.collection.steps.map(s=>s.key),['posts','replies']);
});

test('unknown browser duration keeps its reservation; settlement failure blocks paid fallback',async()=>{
 const unknown=async()=>{throw new ProviderError('BROWSER_FAILED','unknown usage');};
 const transport=apify(),a=ledger();
 await fetchAccount('hkj315',options({fetchImpl:transport.fetchImpl,budget:a.budget,browser:unknown}));
 assert.equal(a.settles.some(([key])=>key==='s1:browser'),false);
 const blocked=apify();
 const budget={reserve(){},settle(){throw Object.assign(new Error('ledger unavailable'),{code:'LEDGER_FAILED'});}};
 await assert.rejects(fetchAccount('hkj315',options({fetchImpl:blocked.fetchImpl,budget,browser:browserWall})),{code:'LEDGER_FAILED'});
 assert.equal(blocked.starts.length,0);
});
