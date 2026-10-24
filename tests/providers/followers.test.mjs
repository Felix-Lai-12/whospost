import test from 'node:test';
import assert from 'node:assert/strict';
import {blobsFromHtml,profileInfo} from '../../server/providers/threads-embedded.mjs';
import {createBrowserFetcher} from '../../server/providers/browser.mjs';
import {fetchAccount} from '../../server/providers/index.mjs';
import {ProviderError} from '../../server/providers/apify.mjs';
import {Store} from '../../server/store.mjs';
import {setLogSink} from '../../worker/log.mjs';
import {profileHtml,profileSplitHtml,repliesHtml} from './fixtures/threads-embedded.mjs';
// Follower count (EXTENSION-SPEC §4.4, §10.3 #17): read from the logged-out profile page by the browser round and saved
// on scan.account; null whenever it was not obtained (Apify rows, a page without it), never 0.
const restore=setLogSink(()=>{});test.after(()=>restore());
test('the owner\'s follower count is read from its own blob even though post authors on the page carry the privacy flag first',()=>{
 const trees=blobsFromHtml(profileSplitHtml('hkj315',10,5753787));
 assert.equal(trees.length,2,'the thread blob and the follower blob are kept; the unrelated one is not');
 assert.deepEqual(profileInfo(trees,'hkj315'),{name:'測試帳號',followers:5753787,isPrivate:false});
 assert.deepEqual(profileInfo(blobsFromHtml(profileSplitHtml('hkj315',3,0)),'hkj315').followers,0,'zero followers is a count');
 assert.equal(profileInfo(blobsFromHtml(repliesHtml()),'hkj315').followers,null,'a page without the record leaves it null');
});
test('a malformed follower count is null, not a number',()=>{
 for(const bad of ['12',-3,1.5,null]){
  const html=profileSplitHtml('hkj315',2,0).replace('"follower_count":0',`"follower_count":${JSON.stringify(bad)}`);
  assert.equal(profileInfo(blobsFromHtml(html),'hkj315').followers,null,String(bad));
 }
});
const fakeBrowser=routes=>({newPage:async()=>{let route;return {on(){},setUserAgent:async()=>{},setViewport:async()=>{},goto:async url=>{route=routes.find(r=>url.includes(r.match));return {status:()=>200};},waitForSelector:async()=>{},content:async()=>route.html,url:()=>'',evaluate:async()=>{},close:async()=>{}};},close:async()=>{},sessionId:()=>'s'});
test('the browser round returns the follower count and privacy flag with the name',async()=>{
 const fetch=createBrowserFetcher({launch:()=>fakeBrowser([{match:'/replies',html:repliesHtml('hkj315',4)},{match:'/@hkj315',html:profileSplitHtml('hkj315',10,1234)}]),sleep:async()=>{}});
 const out=await fetch('hkj315',{profile:{posts:10,replies:20}});
 assert.equal(out.name,'測試帳號');assert.equal(out.followers,1234);assert.equal(out.isPrivate,false);
 const old=await createBrowserFetcher({launch:()=>fakeBrowser([{match:'/replies',html:repliesHtml('hkj315',4)},{match:'/@hkj315',html:profileHtml('hkj315',10)}]),sleep:async()=>{}})('hkj315',{profile:{posts:10,replies:20}});
 assert.equal(old.followers,12,'the one-blob layout still works');
});
const row=(id,kind='post')=>({id:String(id),author:'hkj315',kind,text:`文字 ${id}`,postedAt:'2026-10-17T00:00:00Z',url:`https://www.threads.com/@hkj315/post/${id}`,parentUrl:kind==='post'?null:'https://www.threads.com/@hkj331155/post/p',parentAuthor:kind==='post'?null:'hkj331155',isReply:kind!=='post',source:'cloudflare-browser'});
const json=data=>new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});
const apify={fetchImpl:async(url,init={})=>{
 if(url.includes('cofacts'))return json({data:{ListArticles:{edges:[]}}});
 if(init.method==='POST'||url.includes('/actor-runs/'))return json({data:{id:'r1',status:'SUCCEEDED',defaultDatasetId:'d1',usageTotalUsd:.01}});
 return json([{record_type:'post',id:'1',username:'hkj315',text:'apify 1',url:'https://www.threads.com/@hkj315/post/a1',posted_at:'2026-10-17T00:00:00Z',is_reply:false}]);
}};
const budget={reserve(){},settle(){}};
const options=extra=>({state:{scanId:'s1'},profileId:'standard-20',crossAccountSearch:false,token:'fixture-only',budget,...apify,...extra});
const browser=followers=>async(u,{profile})=>({name:'測試',followers,isPrivate:false,posts:Array.from({length:profile.posts},(_,i)=>row(i+1)),comments:[row(20,'authored_reply')],meta:{browserSeconds:10}});
test('scan.account carries followers from the browser round in browser and hybrid mode; Apify rows leave it null',async()=>{
 assert.deepEqual((await fetchAccount('hkj315',options({browser:browser(1234)}))).account,{username:'hkj315',url:'https://www.threads.com/@hkj315',name:'測試',followers:1234,isPrivate:false});
 assert.equal((await fetchAccount('hkj315',options({browser:browser(0),provider:'hybrid'}))).account.followers,0);
 assert.equal((await fetchAccount('hkj315',options({browser:browser(undefined)}))).account.followers,null,'a round without the count is null');
 const viaApify=(await fetchAccount('hkj315',options({}))).account;
 assert.equal(viaApify.followers,null);assert.equal(viaApify.isPrivate,null);
});
test('a browser failure that falls back to Apify leaves followers null',async()=>{
 const wall=async()=>{throw Object.assign(new ProviderError('BROWSER_WALL','牆'),{meta:{browserSeconds:6}});};
 for(const provider of ['browser','hybrid']){const b=await fetchAccount('hkj315',options({browser:wall,provider,fallback:'apify'}));assert.equal(b.account.followers,null,provider);assert.equal(b.account.isPrivate,null,provider);}
});
test('the scan view carries the reply target\'s follower count from its own saved scan, null when that scan has none',()=>{
 const store=new Store(':memory:');
 const replies=Array.from({length:12},(_,i)=>({id:`c${i}`,author:'sample_fan',kind:'authored_reply',text:`第${i}則完全不同而且夠長的內容`,url:`https://www.threads.com/@sample_fan/post/c${i}`,parentUrl:`https://www.threads.com/@sample_star/post/p${i}`,parentAuthor:'sample_star'}));
 const fan=store.create('sample_fan');store.update(fan.id,{status:'completed',comments:replies});
 const focus=()=>store.scanView(fan.id).score.items.find(i=>i.id==='author-focus');
 assert.deepEqual(focus().evidence,{partner:'sample_star',partnerFollowers:null,popularityTier:null,note:'@sample_star 的粉絲數未取得'},'partner never scanned');
 const before=store.scanView(fan.id).score;
 const star=store.create('sample_star');store.update(star.id,{status:'completed',account:{username:'sample_star',followers:250000},posts:[{id:'p',author:'sample_star',kind:'post',text:'夠長的貼文內容',url:'https://www.threads.com/@sample_star/post/p'}]});
 assert.equal(store.scanView(fan.id).mutual.partnerFollowers,250000);
 assert.equal(focus().evidence.partnerFollowers,250000);assert.equal(focus().evidence.popularityTier,'large');
 assert.equal(focus().status,'yes');assert.equal(focus().contribution,1,'the tier never changes the hit');assert.equal(store.scanView(fan.id).score.value,before.value);
});
