import test from 'node:test';
import assert from 'node:assert/strict';
import {createBrowserFetcher} from '../../server/providers/browser.mjs';
import {normalizeSupplementPost,normalizeAuthoredReply} from '../../server/providers/normalize.mjs';
import {setLogSink} from '../../worker/log.mjs';
import {profileHtml,repliesHtml,repliesGraphql,postPageHtml,loginHtml} from './fixtures/threads-embedded.mjs';
const profile={posts:10,replies:20};
/** A fake puppeteer: routes map a URL substring to {html, status, finalUrl, graphql, delayMs, error}. A scroll answers
 *  with `graphql`, `delayMs` later when given. Records every call. */
function fakeBrowser(routes,calls={pages:0,closedPages:0,closedBrowser:0,scrolls:0}){
 const page=()=>{
  let route=null,handlers={};
  const p={
   on:(event,fn)=>{handlers[event]=fn;},setUserAgent:async()=>{},setViewport:async()=>{},
   goto:async url=>{route=routes.find(r=>url.includes(r.match))??{html:'<html></html>',status:404};if(route.error)throw route.error;if(route.hang)return new Promise(()=>{});p._url=route.finalUrl??url;return {status:()=>route.status??200};},
   waitForSelector:async()=>{},content:async()=>route.html,url:()=>p._url,
   evaluate:async()=>{calls.scrolls++;const respond=()=>handlers.response({headers:()=>({'content-type':'application/json'}),url:()=>'https://www.threads.com/graphql/query',text:async()=>route.graphql});if(route.graphql&&handlers.response){if(route.delayMs)setTimeout(respond,route.delayMs);else await respond();}},
   close:async()=>{calls.closedPages++;}
  };
  calls.pages++;return p;
 };
 return {newPage:async()=>page(),close:async()=>{calls.closedBrowser++;},sessionId:()=>'sess-1'};
}
const routes=[{match:'/replies',html:repliesHtml('hkj315',4),graphql:repliesGraphql('hkj315',7)},{match:'/post/',html:postPageHtml(3)},{match:'/@hkj315',html:profileHtml('hkj315',10)}];
const lines=[];const restore=setLogSink((level,line)=>lines.push(JSON.parse(line)));
test.after(()=>restore());
test('a round reads 10 posts and 11 replies in the Apify row shape, closes every page and the browser, logs browser.fetch',async()=>{
 const calls={pages:0,closedPages:0,closedBrowser:0,scrolls:0},partials=[];
 let t=0;const fetch=createBrowserFetcher({launch:()=>fakeBrowser(routes,calls),now:()=>(t+=1000),sleep:async()=>{}});
 const out=await fetch('HKJ315',{profile,onPartial:p=>partials.push(p),scanId:'s1'});
 assert.equal(out.name,'測試帳號');assert.equal(out.posts.length,10);assert.equal(out.comments.length,11);assert.equal(out.postComments.length,0);
 const apifyPost=normalizeSupplementPost({record_type:'post',id:'1',username:'hkj315',text:'x',posted_at:'2026-01-01T00:00:00Z',url:'https://www.threads.com/@hkj315/post/a'},'hkj315');
 assert.deepEqual(Object.keys(out.posts[0]).filter(k=>k!=='replyCount').sort(),Object.keys(apifyPost).sort(),'same columns as an Apify post');
 const apifyReply=normalizeAuthoredReply({record_type:'reply',id:'2',username:'hkj315',is_reply:true,text:'x',posted_at:'2026-01-01T00:00:00Z',url:'https://www.threads.com/@hkj315/post/b',reply_to_url:'https://www.threads.com/@o/post/1',reply_to_author:'o'},'hkj315');
 assert.deepEqual(Object.keys(out.comments[0]).sort(),Object.keys(apifyReply).sort(),'same columns as an Apify reply');
 assert.equal(out.posts[0].source,'cloudflare-browser');assert.equal(out.comments[0].kind,'authored_reply');assert.ok(out.comments.every(c=>c.parentAuthor&&c.parentAuthor!=='hkj315'&&c.isReply));
 assert.deepEqual(partials.map(p=>Object.keys(p)),[['account','posts'],['comments']]);
 assert.equal(calls.pages,2);assert.equal(calls.closedPages,2);assert.equal(calls.closedBrowser,1);assert.equal(calls.scrolls,1,'one scroll fetched the second page; the tab then said no more');
 assert.equal(out.meta.pages,2);assert.equal(out.meta.sessionId,'sess-1');assert.ok(out.meta.browserSeconds>0);assert.equal(out.meta.httpStatus,200);
 const line=lines.find(l=>l.event==='browser.fetch');assert.equal(line.status,'ok');assert.equal(line.posts,10);assert.equal(line.comments,11);assert.equal(line.scanId,'s1');
});
test('a scroll stops waiting as soon as the next page lands, and waits scrollWaitMs only when nothing comes',async()=>{
 // The next page lands 20 ms after the scroll; the wait cap never ends, so finishing at all means it stopped early.
 const late=[{match:'/replies',html:repliesHtml('hkj315',4),graphql:repliesGraphql('hkj315',7),delayMs:20},{match:'/@hkj315',html:profileHtml('hkj315',10)}];
 const out=await createBrowserFetcher({launch:()=>fakeBrowser(late),sleep:()=>new Promise(()=>{})})('hkj315',{profile});
 assert.equal(out.comments.length,11);assert.equal(out.meta.scrolls,1);
 // Nothing comes back: the scroll waits the cap once, then stops scrolling.
 const waits=[];let t=0;
 const none=[{match:'/replies',html:repliesHtml('hkj315',4)},{match:'/@hkj315',html:profileHtml('hkj315',10)}];
 const empty=await createBrowserFetcher({launch:()=>fakeBrowser(none),now:()=>t,scrollWaitMs:2500,sleep:async ms=>{waits.push(ms);t+=ms;}})('hkj315',{profile});
 assert.deepEqual(waits,[2500]);assert.equal(empty.comments.length,4);assert.equal(empty.meta.scrollMs,2500);
 // A response that adds no rows does not end the wait.
 const noRows=[{match:'/replies',html:repliesHtml('hkj315',4),graphql:'{"data":{"mediaData":{"edges":[]}}}'},{match:'/@hkj315',html:profileHtml('hkj315',10)}];
 waits.length=0;await createBrowserFetcher({launch:()=>fakeBrowser(noRows),now:()=>t,scrollWaitMs:2500,sleep:async ms=>{waits.push(ms);t+=ms;}})('hkj315',{profile});
 assert.deepEqual(waits,[2500]);
});
test('posts and replies are cut to the profile; the account name falls back to null',async()=>{
 const fetch=createBrowserFetcher({launch:()=>fakeBrowser([{match:'/replies',html:repliesHtml('hkj331155',4)},{match:'/@hkj331155',html:profileHtml('hkj331155',10)}]),sleep:async()=>{}});
 const out=await fetch('hkj331155',{profile:{posts:3,replies:2}});
 assert.equal(out.posts.length,3);assert.equal(out.comments.length,2);assert.equal(out.name,null);
});
test('a login redirect or a page without embedded data is BROWSER_WALL; the browser is still closed',async()=>{
 const calls={pages:0,closedPages:0,closedBrowser:0,scrolls:0};
 const fetch=createBrowserFetcher({launch:()=>fakeBrowser([{match:'/@hkj315',html:loginHtml,finalUrl:'https://www.threads.com/login'}],calls),sleep:async()=>{}});
 await assert.rejects(fetch('hkj315',{profile}),{code:'BROWSER_WALL'});
 assert.equal(calls.closedBrowser,1);assert.equal(calls.closedPages,1);
 const wall=createBrowserFetcher({launch:()=>fakeBrowser([{match:'/@hkj315',html:'<html><body>nothing</body></html>'}]),sleep:async()=>{}});
 await assert.rejects(wall('hkj315',{profile}),{code:'BROWSER_WALL'});
 assert.equal(lines.filter(l=>l.event==='browser.fetch'&&l.code==='BROWSER_WALL').length,2);
});
test('a launch that throws or hangs is BROWSER_LAUNCH',async()=>{
 await assert.rejects(createBrowserFetcher({launch:()=>{throw Error('no sessions');}})('hkj315',{profile}),{code:'BROWSER_LAUNCH'});
 await assert.rejects(createBrowserFetcher({launch:()=>new Promise(()=>{}),launchMs:5})('hkj315',{profile}),{code:'BROWSER_LAUNCH'});
});
test('a profile page that hangs is BROWSER_TIMEOUT; the total budget is enforced between steps',async()=>{
 const calls={pages:0,closedPages:0,closedBrowser:0,scrolls:0};
 const fetch=createBrowserFetcher({launch:()=>fakeBrowser([{match:'/@hkj315',hang:true}],calls),pageMs:5,sleep:async()=>{}});
 await assert.rejects(fetch('hkj315',{profile}),{code:'BROWSER_TIMEOUT'});assert.equal(calls.closedBrowser,1);
 let t=0;const slow=createBrowserFetcher({launch:()=>fakeBrowser(routes),now:()=>(t+=30000),totalMs:45000,sleep:async()=>{}});
 await assert.rejects(slow('hkj315',{profile}),{code:'BROWSER_TIMEOUT'});
});
test('a Replies tab that fails keeps the posts, returns no comments and says why in meta',async()=>{
 const fetch=createBrowserFetcher({launch:()=>fakeBrowser([{match:'/replies',error:Error('net::ERR_FAILED')},{match:'/@hkj315',html:profileHtml('hkj315',8)}]),sleep:async()=>{}});
 const out=await fetch('hkj315',{profile});
 assert.equal(out.posts.length,9);assert.deepEqual(out.comments,[]);assert.equal(out.meta.repliesError,'BROWSER_FAILED');
});
test('postPages opens at most that many post pages, only for posts with replies, and never fails the round',async()=>{
 const calls={pages:0,closedPages:0,closedBrowser:0,scrolls:0};
 const fetch=createBrowserFetcher({launch:()=>fakeBrowser([{match:'/post/own1',error:Error('boom')},{match:'/post/',html:postPageHtml(3)},...routes.filter(r=>r.match!=='/post/')],calls),postPages:2,sleep:async()=>{}});
 const out=await fetch('hkj315',{profile});
 assert.equal(calls.pages,4,'profile, replies and two post pages');
 assert.equal(out.postComments.length,3);assert.ok(out.postComments.every(c=>c.postId));
});
test('an unexpected failure inside the round is BROWSER_FAILED with its detail, and the browser is closed',async()=>{
 const calls={pages:0,closedPages:0,closedBrowser:0,scrolls:0};
 const browser=fakeBrowser(routes,calls);browser.newPage=async()=>{throw Error('Target closed');};
 await assert.rejects(createBrowserFetcher({launch:()=>browser})('hkj315',{profile}),e=>e.code==='BROWSER_FAILED'&&e.detail==='Target closed');
 assert.equal(calls.closedBrowser,1);
});
