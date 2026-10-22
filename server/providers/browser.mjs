// Browser fetch provider: opens the account's public Threads pages in a Cloudflare Browser Rendering session,
// logged out and without cookies, and reads the JSON Threads embeds in them. Costs browser time instead of
// Apify credit (about US$0.001 a scan). `launch` is injected: the Worker passes `()=>puppeteer.launch(env.BROWSER)`
// (the Node server has no browser), and tests pass a fake. Nothing here imports @cloudflare/puppeteer.
//
// One round, two pages, in order: the profile (its first page embeds up to 10 posts; scrolling does not load more
// while logged out) and the Replies tab (the account's replies under other people's threads, what Whospost calls
// comments; one scroll fetches one more GraphQL page, about 11 replies in all). Opening post pages for their
// direct replies is optional (postPages, default 0): standard-20 does not need them.
//
// Errors are ProviderErrors with a BROWSER_* code, so the caller can fall back to Apify: BROWSER_LAUNCH (no
// session), BROWSER_WALL (redirected to login or a page without embedded data), BROWSER_TIMEOUT (a page or the
// whole round took too long), BROWSER_FAILED (anything else). A Replies tab that fails after the posts were read
// does not fail the round: the posts go back with no comments and meta.repliesError says why.
import {log,timer} from '../../worker/log.mjs';
import {ProviderError} from './apify.mjs';
import {blobsFromHtml,parseBody,profilePosts,profileReplies,postReplies,profileInfo,hasNext} from './threads-embedded.mjs';
import {normalizeBrowserPost,normalizeBrowserReply,uniqueRecent} from './normalize.mjs';
const ORIGIN='https://www.threads.com';
const UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
export const BROWSER_CODES=new Set(['BROWSER_LAUNCH','BROWSER_WALL','BROWSER_TIMEOUT','BROWSER_FAILED']);
const MESSAGES={BROWSER_LAUNCH:'無法開啟瀏覽器工作階段。',BROWSER_WALL:'Threads 沒有提供這個頁面的公開資料。',BROWSER_TIMEOUT:'讀取 Threads 頁面逾時。',BROWSER_FAILED:'瀏覽器讀取失敗。'};
const fail=(code,detail)=>Object.assign(new ProviderError(code,MESSAGES[code]),detail?{detail:String(detail?.message??detail).slice(0,200)}:{});
const asBrowserError=(e,code='BROWSER_FAILED')=>e instanceof ProviderError&&BROWSER_CODES.has(e.code)?e:fail(code,e);
/** Rejects with `code` when `promise` takes more than `ms`; the timer is cleared when it settles. */
function within(promise,ms,code){let t;return Promise.race([promise,new Promise((_,reject)=>{t=setTimeout(()=>reject(fail(code)),ms);})]).finally(()=>clearTimeout(t));}
/** Keeps the parsed bodies of the GraphQL responses a page fetches on its own (the next page after a scroll),
 *  and calls sink.arrived() when one lands, so a scroll can stop waiting. */
function captureJson(page,sink){
 page.on?.('response',async res=>{
  try{
   const type=res.headers()['content-type']??'';
   if(!/json|javascript/.test(type)||!/graphql|\/api\//.test(res.url()))return;
   const text=await res.text();
   if(!/mediaData|direct_replies|thread_items/.test(text))return;
   const body=parseBody(text);if(body){sink.push(body);sink.arrived?.();}
  }catch{}
 });
}
/**
 * createBrowserFetcher({launch, ...}) → fetch(username, {profile, onPartial, scanId}) resolving
 * {name, posts, comments, postComments, meta}. posts and comments are rows in the shape every other provider
 * produces (normalize.mjs), already cut to profile.posts / profile.replies. meta: durationMs, browserSeconds,
 * pages, scrolls, scrollMs, httpStatus, sessionId, repliesError.
 */
export function createBrowserFetcher({launch,now=Date.now,launchMs=10000,pageMs=20000,settleMs=8000,totalMs=45000,scrollWaitMs=2500,maxScrolls=2,postPages=0,sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 if(typeof launch!=='function')throw new Error('createBrowserFetcher needs launch()');
 return async function fetchWithBrowser(username,{profile={posts:10,replies:20},onPartial=()=>{},scanId,replies=true}={}){
  username=String(username).toLowerCase();
  const elapsed=timer(now),meta={durationMs:0,browserSeconds:0,pages:0,scrolls:0,scrollMs:0,postsEmbedded:0,repliesEmbedded:0,httpStatus:null,sessionId:null,repliesError:null};
  const remaining=()=>totalMs-elapsed();
  const checkTotal=()=>{if(remaining()<=0)throw fail('BROWSER_TIMEOUT');};
  let browser=null,launched=0,posts=[];
  const open=async(url,captured=null)=>{
   checkTotal();
   const page=await browser.newPage();
   if(captured)captureJson(page,captured);
   try{
    await page.setUserAgent?.(UA);await page.setViewport?.({width:1280,height:900});
    const response=await within(page.goto(url,{waitUntil:'domcontentloaded',timeout:pageMs}),Math.min(pageMs+1000,Math.max(1,remaining())),'BROWSER_TIMEOUT');
    await within(page.waitForSelector('script[type="application/json"][data-sjs]',{timeout:settleMs}).catch(()=>{}),settleMs+1000,'BROWSER_TIMEOUT');
    const html=await page.content();
    meta.pages++;
    return {page,status:response?.status?.()??null,finalUrl:String(page.url?.()??url),trees:blobsFromHtml(html)};
   }catch(e){await page.close?.().catch(()=>{});throw e;}
  };
  // A scroll waits until a response it fetched into `sink` adds rows (`grew()`), or scrollWaitMs when none does;
  // meta.scrollMs is the time spent waiting. Rows come from that JSON, not the rendered page, so nothing else waits.
  const scrollOnce=async(page,sink,grew)=>{
   const started=now();let arrived;const next=new Promise(r=>{arrived=r;});
   sink.arrived=()=>{if(grew())arrived();};
   try{await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));if(!grew())await Promise.race([next,sleep(scrollWaitMs)]);}
   finally{sink.arrived=null;meta.scrollMs+=now()-started;}
  };
  const walled=({finalUrl,trees})=>/\/login|\/accounts\//.test(finalUrl)||trees.length===0;
  let result;
  try{
   try{browser=await within(Promise.resolve().then(launch),launchMs,'BROWSER_LAUNCH');}catch(e){throw asBrowserError(e,'BROWSER_LAUNCH');}
   launched=now();meta.sessionId=browser.sessionId?.()??null;
   // 1. Profile: posts and the display name. A wall here fails the round. The first page embeds up to ten
   // threads; when it holds fewer than the profile asks for and says there is more, scrolling is tried, which
   // may or may not fetch another page while logged out.
   const homeCaptured=[],home=await open(`${ORIGIN}/@${username}`,homeCaptured);
   meta.httpStatus=home.status;
   let name=null;
   try{
    if(walled(home))throw fail('BROWSER_WALL');
    const info=profileInfo(home.trees,username);
    name=typeof info?.name==='string'?info.name:null;
    const all=()=>[...home.trees,...homeCaptured];
    let rows=profilePosts(home.trees,username);
    meta.postsEmbedded=rows.length;
    for(let i=0;i<maxScrolls&&rows.length<profile.posts&&hasNext([homeCaptured.at(-1)??home.trees.at(-1)],'mediaData')&&remaining()>scrollWaitMs+pageMs;i++){
     const before=homeCaptured.length,had=rows.length;await scrollOnce(home.page,homeCaptured,()=>profilePosts(all(),username).length>had);rows=profilePosts(all(),username);
     meta.scrolls++;
     if(homeCaptured.length===before)break;
    }
    posts=uniqueRecent(rows.map(r=>normalizeBrowserPost(r,username)),profile.posts);
   }finally{await home.page.close?.().catch(()=>{});}
   onPartial({account:{name},posts});
   // 2. Replies tab: the account's replies under other people's posts. Scrolls while the tab says there is more.
   let comments=[],postComments=[];
   if(replies)try{
    const captured=[],tab=await open(`${ORIGIN}/@${username}/replies`,captured);
    try{
     const all=()=>[...tab.trees,...captured];
     let rows=profileReplies(all(),username);
     meta.repliesEmbedded=rows.length;
     // The first scroll is always tried: logged out, the tab's page_info said no more while a scroll still loaded a page.
     for(let i=0;i<maxScrolls&&rows.length<profile.replies&&(i===0||hasNext([captured.at(-1)],'mediaData'))&&remaining()>scrollWaitMs;i++){
      const before=captured.length,had=rows.length;await scrollOnce(tab.page,captured,()=>profileReplies(all(),username).length>had);rows=profileReplies(all(),username);
      if(captured.length===before)break;
      meta.scrolls++;
     }
     comments=uniqueRecent(rows.map(r=>normalizeBrowserReply(r,username)),profile.replies);
    }finally{await tab.page.close?.().catch(()=>{});}
   }catch(e){meta.repliesError=asBrowserError(e).code;}
   if(replies)onPartial({comments});
   // 3. Optional: direct replies under the first posts that have any, one page each, never failing the round.
   for(const post of posts.filter(p=>p.replyCount>0).slice(0,postPages)){
    if(remaining()<=pageMs)break;
    try{const page=await open(post.url);try{postComments.push(...postReplies(page.trees).filter(r=>r.id!==post.id).map(r=>({...r,postId:post.id})));}finally{await page.page.close?.().catch(()=>{});}}catch{}
   }
   result={name,posts,comments,postComments,meta};
  }catch(e){
   const error=asBrowserError(e);
   meta.durationMs=elapsed();meta.browserSeconds=launched?Number(((now()-launched)/1000).toFixed(1)):0;error.meta={...meta,posts:posts.length};
   log('warn','browser.fetch',{scanId,username,status:'failed',code:error.code,detail:error.detail,...meta});
   throw error;
  }finally{if(browser)await browser.close?.().catch(()=>{});}
  meta.durationMs=elapsed();meta.browserSeconds=launched?Number(((now()-launched)/1000).toFixed(1)):0;
  log('info','browser.fetch',{scanId,username,status:'ok',posts:result.posts.length,comments:result.comments.length,...meta});
  return result;
 };
}
