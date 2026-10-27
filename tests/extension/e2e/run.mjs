// End-to-end run of the extension (EXTENSION-SPEC §6.3): Playwright's Chromium loads extension/ (its new headless mode
// still allows --load-extension; Chrome stable 137+ does not) and drives a Threads post page.
//   --fixture (default; the CI gate): fixture/post.html is served under the real threads.com URL through request
//     routing, so the content script runs exactly as installed; the list is seeded into storage; every expectation is
//     asserted and the process exits 1 if any failed. Offline apart from the extension's own calls to the site.
//   --live [url]: the real logged-out page (default: a public @zuck post); screenshots for review; exits 1 only when
//     the engine reports the layout changed — the daily job answering 「版面壞了多久」 before users do — else 0 with warnings.
// --out <dir> (default ./e2e-out) collects screenshots and result.json. Needs Playwright with Chromium installed.
// --api <base>: the API base the extension talks to (its 進階 setting), e.g. http://localhost:8787 for a local
//   `wrangler dev` started with WHOSPOST_EXTENSION_IDS naming this extension; then 即時查 runs a real scan (live mode)
//   and the three screenshots (scanning / 快篩 / done) land in --out. Without it, fixture mode starts its own fake API
//   on localhost that answers the list (404, as the site does today), one scan with a 快篩 then a full result, and one
//   that fails; live mode without --api skips the 即時查 steps (the site's whitelist does not name a test build).
// --fake-api: live mode with that same fake API instead of a Worker, so the 即時查 screenshots come from the real page
//   without a real scan (the fake answers any account there with the 快篩-then-4-hits story; nothing is sent anywhere).
// --viewport WxH (default 1280x900): the page size; the Web Store wants 1280x800 screenshots (scripts/store-screenshots.mjs).
// --mask: before every screenshot, the accounts on the page get stand-in names (user01, user02, …) and grey avatars,
//   in the page text and in the extension's own chips, rows, toasts and popover. The store screenshots use it: the
//   seeded list is made up, so no real account should appear beside a made-up signal in public. Checks are unaffected
//   (they read the links' hrefs, which stay). Put the boolean flags last or before another --flag.
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {BODIES,FIXTURE_URL} from './capture-fixture-meta.mjs';
const {chromium}=await import('playwright');
const args=process.argv.slice(2);
const flag=name=>{const i=args.indexOf(name);return i>=0?(args[i+1]&&!args[i+1].startsWith('--')?args[i+1]:true):null;};
const LIVE=flag('--live'),OUT=path.resolve(typeof flag('--out')==='string'?flag('--out'):'./e2e-out'),API=typeof flag('--api')==='string'?flag('--api').replace(/\/$/,''):null;
const FAKE_API=!!flag('--fake-api'),MASK=!!flag('--mask');
const VIEWPORT=(()=>{const v=flag('--viewport'),m=typeof v==='string'?v.match(/^(\d+)x(\d+)$/):null;return m?{width:+m[1],height:+m[2]}:{width:1280,height:900};})();
const POST=typeof LIVE==='string'?LIVE:'https://www.threads.com/@zuck/post/DeZtp-TkQHh';
const EXT=path.resolve(import.meta.dirname,'../../../extension'),SITE='https://whospost.felixlai.workers.dev';
const sha=t=>createHash('sha256').update(t).digest('hex');
const today=()=>new Date(Date.now()+8*3600000).toISOString().slice(0,10);
fs.mkdirSync(OUT,{recursive:true});
// Fixture mode's stand-in for the site: CORS for any extension origin, the list off (404), a scan for user08 that answers
// running → running with a 快篩 → completed, one for user17 that fails, telemetry and appeals accepted. Records every call.
// /api/health answers the extension switches (worker/extension-flags.mjs); the 封鎖助手 phase flips block to test 「關了按鈕不出現」.
const fakeFlags={block:true};
const SCAN_ID='0f1e2d3c-4b5a-4968-8776-655443322110',FAIL_ID='1f1e2d3c-4b5a-4968-8776-655443322111';
const RULES=['content-posts','content-comments','author-focus','thread-focus','mutual-focus','burst-replies'];
const scoreItems=yes=>RULES.map(id=>({id,label:id,status:yes.includes(id)?'yes':id==='mutual-focus'?'unknown':'no',contribution:yes.includes(id)?1:0}));
function fakeApi(){
 const calls=[],polls={};
 const server=http.createServer((req,res)=>{
  const origin=req.headers.origin??'';let body='';
  req.on('data',c=>{body+=c;});
  req.on('end',()=>{
   const cors={'Access-Control-Allow-Origin':origin,'Vary':'Origin','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, If-None-Match','Access-Control-Expose-Headers':'ETag'};
   const send=(status,value)=>{res.writeHead(status,{...cors,'Content-Type':'application/json; charset=utf-8'});res.end(value===null?'':JSON.stringify(value));};
   calls.push({method:req.method,path:req.url,origin,cookie:req.headers.cookie??null,body:body||null});
   if(req.method==='OPTIONS')return send(204,null);
   if(req.url==='/api/scans'&&req.method==='POST'){
    let username='';try{username=new URL(JSON.parse(body).url).pathname.replace(/^\/@/,'').replace(/\/$/,'');}catch{}
    if(!/^chrome-extension:\/\/[a-p]{32}$/.test(origin))return send(403,{error:'不接受外部網站啟動查詢'});
    let savedOnly=false;try{savedOnly=JSON.parse(body).savedOnly===true;}catch{}
    if(savedOnly)return send(404,{code:'NOT_SAVED',error:'Whospost 還沒查過這個帳號。'});
    if(username==='user17')return send(202,{id:FAIL_ID,status:'queued'});
    // Fixture: only user08 has a story. Live with --fake-api: whichever account the run picks gets it.
    if(username==='user08'||LIVE)return send(202,{id:SCAN_ID,status:'queued'});
    return send(429,{code:'HOURLY_QUOTA',error:'每個網路位置每小時最多 10 次新查詢'});
   }
   const ai=req.url.match(/^\/api\/scans\/([\w-]+)\/ai$/);
   if(ai&&req.method==='GET'){
    const n=polls[`ai:${ai[1]}`]=(polls[`ai:${ai[1]}`]??0)+1;
    if(ai[1]!==SCAN_ID)return send(200,{scanId:ai[1],account:'user17',status:'no_data'});
    return send(200,n<2?{scanId:SCAN_ID,account:'user08',status:'processing'}:{scanId:SCAN_ID,account:'user08',status:'ready',result:{conclusion:'user08 在同一串十秒內連留三則幾乎相同的回覆。粉絲也可能這樣。'},provenance:{model:'claude-sonnet-5-5'}});
   }
   const m=req.url.match(/^\/api\/scans\/([\w-]+)$/);
   if(m&&req.method==='GET'){
    const n=polls[m[1]]=(polls[m[1]]??0)+1,base={id:m[1],account:{username:m[1]===SCAN_ID?'user08':'user17'},score:{value:null,assessed:0,unknown:6,items:scoreItems([])}};
    if(m[1]===FAIL_ID)return send(200,n<2?{...base,status:'running',progress:'取得公開發文與留言'}:{...base,status:'failed',error:{code:'PROVIDER_FAILED',message:'取數失敗，未取得可分析資料。'}});
    if(m[1]!==SCAN_ID)return send(404,{error:'找不到查詢紀錄'});
    if(n<2)return send(200,{...base,status:'running',progress:'取得公開發文與留言'});
    if(n<4)return send(200,{...base,status:'running',progress:'取得公開發文與留言',quick:{partial:true,source:'browser',at:new Date().toISOString(),posts:10,comments:9,score:{value:2,version:'signals-v2',assessed:4,unknown:2,hits:['content-comments','thread-focus']}}});
    return send(200,{...base,status:'completed',completedAt:new Date().toISOString(),quick:null,score:{value:4,version:'signals-v2',assessed:5,unknown:1,items:scoreItems(['content-comments','author-focus','thread-focus','burst-replies'])}});
   }
   if(req.url==='/api/health')return send(200,{ok:true,extension:{...fakeFlags}});
   if(req.url.startsWith('/api/list/v1/export'))return send(404,{error:'找不到API'});
   if(req.url.startsWith('/api/list/v1/'))return send(200,{ok:true,recorded:true});
   send(404,{error:'找不到API'});
  });
 });
 return new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve({calls,polls,base:`http://127.0.0.1:${server.address().port}`,close:()=>new Promise(r=>server.close(r))})));
}
const fake=(!LIVE||FAKE_API)&&!API?await fakeApi():null;
const apiBase=API??fake?.base??null;
const results=[];let failed=0;
/** Records one expectation. In fixture mode a miss fails the run; in live mode only `hard` ones do. */
const check=(name,ok,detail='',{hard=!LIVE}={})=>{results.push({name,ok:!!ok,detail:String(detail).slice(0,400)});const mark=ok?'✔':hard?'✖':'⚠';console.log(`${mark} ${name}${ok?'':` — ${String(detail).slice(0,300)}`}`);if(!ok&&hard)failed++;};
const ctx=await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(),'whospost-e2e-')),{channel:'chromium',headless:true,locale:'zh-TW',viewport:VIEWPORT,args:[`--disable-extensions-except=${EXT}`,`--load-extension=${EXT}`]});
const sw=ctx.serviceWorkers()[0]||await ctx.waitForEvent('serviceworker');
const extId=new URL(sw.url()).host;
console.log('extension',extId,LIVE?`live ${POST}`:'fixture',`${VIEWPORT.width}x${VIEWPORT.height}`,FAKE_API?'fake api':'',MASK?'masked':'');
let fixtureHtml=null;
if(!LIVE){
 // Each reply's ⋯ gets a menu like Threads' (fixture/reply-menu.js) for 封鎖助手 and 檢舉.
 const replyMenu=fs.readFileSync(path.join(import.meta.dirname,'fixture','reply-menu.js'),'utf8');
 fixtureHtml=fs.readFileSync(path.join(import.meta.dirname,'fixture','post.html'),'utf8').replace(/<\/body>/i,`<script>${replyMenu}</script></body>`);
 // The broken variant: profile links no longer start with /@, so no author is found while the permalinks remain.
 const brokenHtml=fixtureHtml.replace(/href="\/@/g,'href="/u/@');
 await ctx.route('**/*',route=>{
  const u=route.request().url();
  if(u.startsWith('chrome-extension://')||u.startsWith(SITE)||(apiBase&&u.startsWith(apiBase)))return route.continue();
  if(u.split('?')[0]===FIXTURE_URL)return route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:fixtureHtml});
  if(u.split('?')[0]===FIXTURE_URL.replace('FIXTURE0001','FIXTURE0002'))return route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:brokenHtml});
  return route.abort();
 });
}
const logs=[];
sw.on('console',m=>logs.push(`[sw:${m.type()}] ${m.text().slice(0,300)}`));
const page=await ctx.newPage();
page.on('console',m=>{if(/whospost/i.test(m.text())||m.type()==='error')logs.push(`[${m.type()}] ${m.text().slice(0,300)}`);});
page.on('pageerror',e=>logs.push(`[pageerror] ${String(e).slice(0,300)}`));
const popup=await ctx.newPage();await popup.goto(`chrome-extension://${extId}/popup.html`);
const local=async key=>popup.evaluate(k=>chrome.storage.local.get(k).then(r=>r[k]),key);
// The fold and fade paths are still in the engine, but since Felix 10-26 the default is 只標籤 and the popup offers no
// choice; this run asks for 收起 in storage so those paths stay covered (settings.test pins the default).
await popup.evaluate(async()=>{const s=(await chrome.storage.sync.get('settings')).settings??{};await chrome.storage.sync.set({settings:{...s,mode:'collapse'}});});
// The API base (進階 setting) goes in before anything is fetched; the popup then refreshes the list from there.
if(apiBase){
 await popup.evaluate(async base=>{const s=(await chrome.storage.sync.get('settings')).settings??{};await chrome.storage.sync.set({settings:{...s,apiBase:base}});},apiBase);
 // On install the background already asked the site for the list, before the setting existed — and since the site's
 // list API went live (10-24) that fetch succeeds. Let it settle (a refresh sent meanwhile would just join it), drop
 // that copy, then fetch again from the base above, so the run only ever sees the API it was pointed at.
 for(let i=0;i<40;i++){const l=await local('list');if(l&&(l.failedAt||l.fetchedAt))break;await popup.waitForTimeout(250);}
 await popup.evaluate(async()=>{await chrome.storage.local.remove('list');await new Promise(r=>chrome.runtime.sendMessage({type:'refreshList'},()=>{void chrome.runtime.lastError;r();}));});
 console.log('api base',apiBase);
}
for(let i=0;i<40;i++){const l=await local('list');if(l&&(l.failedAt||l.fetchedAt)){console.log('list fetch:',l.fetchedAt?`ok (${l.accounts?.length} accounts)`:`failed (${l.failure})`);break;}await popup.waitForTimeout(250);}
const url=LIVE?POST:FIXTURE_URL;
await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});
await page.waitForTimeout(LIVE?6000:2500);
if(LIVE)for(let i=0;i<2;i++){await page.mouse.wheel(0,900);await page.waitForTimeout(1200);}
// Live only: Threads keeps reopening its logged-out sign-in dialog; hide that subtree so screenshots show the page.
const dismiss=async()=>{if(!LIVE)return;await page.keyboard.press('Escape');await page.waitForTimeout(300);await page.evaluate(()=>{for(const d of document.querySelectorAll('[role=dialog]')){if(d.classList.contains('whospost-pop'))continue;let n=d;while(n.parentElement&&n.parentElement!==document.body&&!n.parentElement.querySelector('[data-pressable-container]'))n=n.parentElement;n.style.display='none';}});await page.waitForTimeout(200);};
const top=async loc=>{await loc.evaluate(el=>{el.scrollIntoView({block:'start'});window.scrollBy(0,-140);});await page.waitForTimeout(500);};
const snap=()=>page.evaluate(()=>{const cs=[...document.querySelectorAll('div[data-pressable-container="true"]')];const own=c=>[...c.querySelectorAll('a[href^="/@"]')].find(a=>a.closest('[data-pressable-container]')===c&&/^\/@[^/]+\/?$/.test(a.getAttribute('href')))?.getAttribute('href').replace(/^\/@/,'').replace(/\/$/,'').toLowerCase()??null;const chipOf=c=>[...c.querySelectorAll('.whospost-chip:not(.whospost-chip-static)')].map(b=>`${b.className.split(' ').filter(x=>/^whospost-chip-(orange|grey|blue|green|clear)$/.test(x)).map(x=>x.replace('whospost-chip-','')).join('')}${b.classList.contains('whospost-chip-busy')?'/busy':''}${b.classList.contains('whospost-chip-partial')?'/partial':''}:${b.textContent}`)[0]??null;return {rows:cs.map(c=>({author:own(c),state:c.getAttribute('data-whospost'),chip:chipOf(c),icon:!!c.querySelector('.whospost-live')})),stubs:[...document.querySelectorAll('.whospost-stub')].map(s=>s.textContent.trim()),pill:document.querySelector('.whospost-pill')?.textContent??null,health:document.querySelector('.whospost-pill')?.getAttribute('data-whospost-health')??null,note:document.querySelector('.whospost-note')?.textContent??null,toast:document.querySelector('.whospost-toast')?.textContent??null,popover:document.querySelector('.whospost-pop')?.innerText??null};});
// --mask: stand-in names and avatars for the accounts on the page, applied to text nodes (the page's and ours) right
// before a screenshot; the same account always gets the same stand-in. Links keep their hrefs, so the engine is unaffected.
const mask=async()=>{if(!MASK)return;await page.evaluate(()=>{
 const AVATAR='data:image/svg+xml;utf8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="#d4d8dd"/><circle cx="20" cy="16" r="7" fill="#fff"/><path d="M7 36a13 13 0 0 1 26 0z" fill="#fff"/></svg>');
 const map=window.__whospostMask??(window.__whospostMask=new Map());
 for(const a of document.querySelectorAll('a[href^="/@"]')){const n=(a.getAttribute('href').match(/^\/@([^/?#]+)/)??[])[1];if(n&&!map.has(n))map.set(n,`user${String(map.size+1).padStart(2,'0')}`);}
 const esc=t=>t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const rules=[...map.entries()].sort((a,b)=>b[0].length-a[0].length).map(([real,fake])=>[new RegExp(`(^|[^A-Za-z0-9_.])${esc(real)}(?![A-Za-z0-9_.])`,'g'),`$1${fake}`]);
 // documentElement, not body: the engine hangs its toast, popover and pill off <html>.
 const walker=document.createTreeWalker(document.documentElement,NodeFilter.SHOW_TEXT);
 for(let t=walker.nextNode();t;t=walker.nextNode()){let v=t.nodeValue;for(const [re,to] of rules)v=v.replace(re,to);if(v!==t.nodeValue)t.nodeValue=v;}
 for(const img of document.querySelectorAll('div[data-pressable-container] img, .whospost-stub-avatar img'))if(img.width<=120&&img.src!==AVATAR){img.src=AVATAR;img.removeAttribute('srcset');}
});await page.waitForTimeout(150);};
// Escape (in dismiss) would also close our popover, so the popover shot skips it.
const shot=async(name,{hide=true}={})=>{if(hide)await dismiss();await mask();await page.screenshot({path:path.join(OUT,`${name}.png`)});};
const by=(s,author)=>s.rows.filter(r=>r.author===author);
const waitFor=async(fn,ms=15000)=>{const end=Date.now()+ms;let v;while(Date.now()<end){v=await fn();if(v)return v;await page.waitForTimeout(300);}return v;};
try{
// ---- Phase A: no list yet (the production list API is off until launch, so this is also what users see today).
const a=await snap();
console.log('A',JSON.stringify({states:a.rows.map(r=>r.state),pill:a.pill,note:a.note}));
const replies=a.rows.filter(r=>r.author&&r.state);
check('page parsed: reply containers with authors',replies.length>=5,`${replies.length} replies`,{hard:true});
check('health: engine does not report the layout changed',a.health!=='broken',a.pill,{hard:true});
const listStatus=(await local('list'))?.fetchedAt?'fresh':'missing';
if(listStatus==='missing'){check('list unreadable → grey line, no pill',a.note==='清單暫時無法讀取'&&a.pill===null,`note=${a.note} pill=${a.pill}`);}
if(!LIVE){
 for(const u of ['user04','user05','user06'])check(`${u}: same text from 3 accounts → blue chip`,by(a,u)[0]?.chip==='blue:3 個帳號貼同一段'&&by(a,u)[0]?.state==='info',JSON.stringify(by(a,u)[0]));
 // Felix 10-23: the thread mark goes on the account's first reply only; the other four draw nothing for the thread.
 check('user07: five replies → 「本串 5 則」 on the first reply only, the rest unmarked',by(a,'user07').length===5&&by(a,'user07')[0]?.chip==='blue:本串 5 則'&&by(a,'user07')[0]?.state==='info'&&by(a,'user07').slice(1).every(r=>!r.chip&&r.state==='stale'&&r.icon),JSON.stringify(by(a,'user07')));
 check('unknown accounts: stale, hover icon, no chip',['user01','user02','user03','user08','user17'].every(u=>by(a,u)[0]?.state==='stale'&&by(a,u)[0]?.icon&&!by(a,u)[0]?.chip),JSON.stringify(by(a,'user08')));
 check('the author\'s own replies and related threads are left alone (the main post is marked like anyone, Felix 10-26)',by(a,'opaccount').slice(1).every(r=>!r.state&&!r.chip&&!r.icon)&&a.rows.filter(r=>/^other/.test(r.author??'')).every(r=>!r.state&&!r.chip),JSON.stringify(a.rows.filter(r=>r.author==='opaccount'||/^other/.test(r.author??''))));
}
await shot(LIVE?'ui2-0-list-api-off':'f0-no-list');
// ---- Phase B: a list with three accounts seen on the page (4, 3 and 1 hits).
const op=new URL(url).pathname.match(/^\/@([^/]+)/)[1].toLowerCase();
const authors=LIVE?[...new Set(replies.map(r=>r.author))].filter(x=>x!==op).slice(0,3):['user01','user02','user03'];
const entries=[];
if(authors[0])entries.push({h:sha(authors[0]),score:4,hits:['content-comments','thread-focus','author-focus','burst-replies'],assessed:5,unknown:1,evidence:'rules',ai:null,scanId:'fixture-scan-1',updated:'2026-10-18T03:00:00Z',appeals:0});
if(authors[1])entries.push({h:sha(authors[1]),score:3,hits:['content-comments','thread-focus','author-focus'],assessed:4,unknown:2,evidence:'rules',ai:null,scanId:'fixture-scan-2',updated:'2026-10-20T03:00:00Z',appeals:1});
// The third account carries an AI summary (the popover's AI 判讀 part); the other two have none (the part is left out).
const AI_SUMMARY='留言多是很短的附和句，一半以上集中在同一位作者的貼文下。';
// It also carries a background other users reported (Felix 10-27): shown without this browser reading anything.
if(authors[2])entries.push({h:sha(authors[2]),score:1,hits:['content-comments'],assessed:4,unknown:2,evidence:'rules',ai:{summary:AI_SUMMARY,version:'claude-sonnet-5-5'},scanId:'fixture-scan-3',updated:'2026-10-18T03:00:00Z',appeals:0,...(LIVE?{}:{profile:{country:'US',place:null,joined:'2023-07',reports:2}})});
// Someone already checked user12 and nothing was found (Felix 10-26: everyone's results reach everyone): no chip, and
// no 即時查 either.
if(!LIVE)entries.push({h:sha('user12'),score:0,hits:[],assessed:5,unknown:1,evidence:null,ai:null,scanId:'fixture-scan-0',updated:'2026-10-26T03:00:00Z',appeals:0});
await popup.evaluate(async({entries})=>{await chrome.storage.local.set({list:{version:'signals-v2',accounts:entries,generated:new Date().toISOString(),etag:'"fixture"',fetchedAt:Date.now(),failedAt:null,failure:null}});},{entries});
if(LIVE)await popup.evaluate(async()=>{const s=(await chrome.storage.sync.get('settings')).settings??{};await chrome.storage.sync.set({settings:{...s,thread:{...s.thread,barAt:2,sameContentAt:2}}});});
await page.waitForTimeout(2500);
const b=await snap();
console.log('B',JSON.stringify({states:b.rows.map(r=>r.state),chips:b.rows.map(r=>r.chip).filter(Boolean),stubs:b.stubs,pill:b.pill}));
if(!LIVE){const u12=by(b,'user12')[0];check('checked by someone, nothing found: a light green 暫無疑慮 and no 即時查 control (Felix 10-26)',!!u12&&u12.chip==='clear:暫無疑慮'&&!u12.icon,JSON.stringify(u12));}
const g1=by(b,authors[0])[0],g2=by(b,authors[1])[0],g3=by(b,authors[2])[0];
check('two accounts at ≥3 hits are folded into one group',g1?.state==='group'&&g2?.state==='group',JSON.stringify([g1,g2]));
check('folded row: 「已收起 2 則」 with the two most common reasons, 顯示, 都信任',b.stubs.length===1&&/^已收起 2 則/.test(b.stubs[0])&&/留言大量重複/.test(b.stubs[0])&&/顯示/.test(b.stubs[0])&&/都信任/.test(b.stubs[0]),b.stubs.join(' | '));
// Felix 10-24: beside the name only the reason chips (and the place); the 「6 項中 N 項符合」 chip is not drawn, the fold
// still goes by the score.
const reasonsOf=u=>page.evaluate(u=>{const c=[...document.querySelectorAll('div[data-pressable-container="true"]')].find(c=>c.querySelector(`a[href^="/@${u}"]`));return {reasons:[...(c?.querySelectorAll('.whospost-chip-reason')??[])].map(n=>`${n.classList.contains('whospost-chip-grey')?'grey':n.classList.contains('whospost-chip-orange')?'orange':'?'}:${n.textContent}`),score:/項符合/.test([...(c?.querySelectorAll('.whospost-chip')??[])].map(n=>n.textContent).join(' '))};},u);
check('one hit → grey reason chip 「留言大量重複」 beside the name, no 「6 項中 1 項符合」 chip, not folded',g3?.chip==='grey:留言大量重複'&&g3?.state==='info',JSON.stringify(g3));
if(!LIVE){const r=await reasonsOf(authors[2]);check('beside the name: just the reason chip, no score chip',JSON.stringify(r)===JSON.stringify({reasons:['grey:留言大量重複'],score:false}),JSON.stringify(r));}
check('pill: 「已收起 2 則 · 顯示全部」, grey line gone',/已收起 2 則/.test(b.pill??'')&&/顯示全部/.test(b.pill??'')&&b.note===null,`pill=${b.pill} note=${b.note}`);
const stub=page.locator('.whospost-stub').first();
if(await stub.count()){await top(stub);}
await shot(LIVE?'ui2-1-default-folded':'f1-default-folded');
// The popup: this page's summary and the reporting line, after the tally reached the background.
const report=await waitFor(async()=>{const r=await local('report');return r?.tally?.collapsed>=2?r:null;},16000);
check('回報貢獻: today\'s tally holds this page\'s counts (pages, compared, listed, flagged, thread, collapsed)',report?.tally&&report.tally.pages>=1&&report.tally.compared>=(LIVE?3:17)&&report.tally.listed>=3&&report.tally.flagged>=2&&report.tally.thread>=(LIVE?1:4)&&report.tally.collapsed>=2,JSON.stringify(report?.tally));
check('回報貢獻: the record names no account',!JSON.stringify(report??{}).match(/user0|@|[a-f0-9]{64}/),JSON.stringify(report).slice(0,200));
await popup.reload();await popup.waitForTimeout(800);
const popupText=(await popup.innerText('body')).replace(/\n+/g,' | ');
console.log('POPUP',popupText.slice(0,500));
check('popup dashboard (Felix 10-27): AI 打詐 · 查詢背景 · 封鎖, all 0 so far; no 已分析, no 已存 N 個帳號',JSON.stringify(await popup.locator('#dashboard .label').allInnerTexts())===JSON.stringify(['AI 打詐','查詢背景','封鎖'])&&await popup.innerText('#d-queried')==='0'&&await popup.innerText('#d-background')==='0'&&!/已分析|已存 \d+ 個帳號/.test(popupText),`${await popup.innerText('#dashboard')} | ${popupText.slice(0,300)}`);
check('popup: no mode choice, no feature switches, no trust or blocked lists',await popup.locator('input[name="mode"], #report, #profileLookup, #showIcon, #threadEnabled, #trusted, #blocked').count()===0,'');
await popup.screenshot({path:path.join(OUT,LIVE?'ui2-4-popup.png':'f4-popup.png'),fullPage:true});
// The popup at its own width (popup.css: 340px body), for a store screenshot to set beside the page.
if(LIVE)await popup.screenshot({path:path.join(OUT,'popup-clip.png'),clip:{x:0,y:0,width:368,height:Math.min(await popup.evaluate(()=>document.documentElement.scrollHeight),VIEWPORT.height)}});
// ---- 顯示 → the run opens as dimmed replies with orange chips; the popover; trust; undo.
if(await stub.count()){
 await stub.locator('.whospost-stub-primary').dispatchEvent('click');await page.waitForTimeout(1200);
 const s=await snap();
 check('顯示: both replies dimmed with orange reason chips, toast 「已顯示 2 則 · 復原」',by(s,authors[0])[0]?.state==='fade'&&by(s,authors[0])[0]?.chip==='orange:留言大量重複'&&by(s,authors[1])[0]?.chip==='orange:留言大量重複'&&/已顯示 2 則/.test(s.toast??'')&&/復原/.test(s.toast??''),JSON.stringify({a:by(s,authors[0])[0],b:by(s,authors[1])[0],toast:s.toast,stubs:s.stubs}));
 check('顯示: pill gone (nothing folded)',s.pill===null,s.pill);
 if(!LIVE){const {reasons:r,score}=await reasonsOf(authors[0]);check('顯示: orange reason chips in rule order (the first two of four, Felix 10-26, or only the first when the line is too short), no score chip',!score&&r.length>=1&&r[0]==='orange:留言大量重複'&&(r.length===1||JSON.stringify(r)===JSON.stringify(['orange:留言大量重複','orange:同篇超過 10 次'])),JSON.stringify({r,score}));}
 await page.waitForTimeout(5500);
 const chip=page.locator('.whospost-chip-orange:not(.whospost-chip-static)').first();
 await dismiss();await top(chip);
 await chip.dispatchEvent('click');await page.waitForTimeout(700);
 const p=await snap();
 console.log('POPOVER',JSON.stringify(p.popover));
 // Felix 10-24: no counts line, no reason chips, no disclaimer, no 信任 button, no 申訴 link in the popover; this account
 // has no AI summary, so no AI part and no 「僅供參考」 line either: the buttons follow the title.
 check('popover without an AI summary: title 「@xx」 alone (Felix 10-26) with the four reason chips on its line, then the buttons; no disclaimer, no AI part, no counts line, no 信任, no 申訴',await page.locator('.whospost-pop .whospost-pop-title').innerText()===`@${authors[0]}`&&!/項中 \d 項符合/.test(p.popover??'')&&!/留言像機器在發|在同一篇下|貼文一再重複|集中回覆同一個人/.test(p.popover??'')&&/看完整證據/.test(p.popover??'')&&!/這不是身分判定|僅供參考|項檢查中|查於|AI 判讀|信任這個帳號|取消信任|申訴或要求刪除/.test(p.popover??'')&&await page.locator('.whospost-pop .whospost-pop-head + .whospost-pop-btns').count()===1&&JSON.stringify(await page.locator('.whospost-pop .whospost-pop-head .whospost-chip').allInnerTexts())===JSON.stringify(['留言大量重複','同篇超過 10 次','半數以上給同一作者','10 秒內連留 3 次']),p.popover);
 check('popover: no troll probability or verdict wording',!/%|網軍的機率|可能是網軍|判定為/.test(p.popover??''),p.popover);
 await shot(LIVE?'ui2-2-popover':'f2-popover',{hide:false});
 await page.keyboard.press('Escape');await page.waitForTimeout(300);
}else check('folded row present for the 顯示 / popover / 信任 steps',false,'no .whospost-stub');
// ---- 都信任 on a fresh fold: once undone right away (does not count), once for keeps (counts two presses).
// The page's own counts go out about 5 s after a scan; waiting that out first makes the tally's trusted count exact.
await page.reload({waitUntil:'domcontentloaded'});await page.waitForTimeout(LIVE?6000:5500);
const stub2=page.locator('.whospost-stub').first();
if(await stub2.count()){
 await stub2.locator('.whospost-stub-action').nth(1).dispatchEvent('click');await page.waitForTimeout(1200);
 const s=await snap();
 const trustedNow=await local('trusted');
 check('都信任: stored under each account hash with the username',trustedNow?.[sha(authors[0])]?.username===authors[0]&&trustedNow?.[sha(authors[1])]?.username===authors[1],JSON.stringify(trustedNow));
 await dismiss();await page.locator('[data-whospost="trusted"]').first().evaluate(el=>el.scrollIntoView({block:'center'}));await page.waitForTimeout(400);
 await shot(LIVE?'ui2-3-trusted-toast':'f3-trusted-toast');
 check('都信任: both accounts trusted, toast 「已信任 2 個帳號，之後不再收起 · 復原」',by(s,authors[0])[0]?.state==='trusted'&&by(s,authors[1])[0]?.state==='trusted'&&/已信任 2 個帳號，之後不再收起/.test(s.toast??'')&&s.stubs.length===0,JSON.stringify({toast:s.toast,stubs:s.stubs}));
 await page.locator('.whospost-toast-undo').dispatchEvent('click');await page.waitForTimeout(1200);
 const u=await snap();
 check('都信任 → 復原: the folded row is back',u.stubs.length===1&&/^已收起 2 則/.test(u.stubs[0])&&Object.keys((await local('trusted'))??{}).length===0,JSON.stringify({stubs:u.stubs,trusted:await local('trusted')}));
 await page.waitForTimeout(4500);
 // A live page can re-render the run away after 復原; warn instead of timing out on a row that is gone.
 if(await page.locator('.whospost-stub').count()){await page.locator('.whospost-stub').first().locator('.whospost-stub-action').nth(1).dispatchEvent('click');await page.waitForTimeout(1200);
 check('都信任 again, kept: two accounts in the trust list',Object.keys((await local('trusted'))??{}).length===2,JSON.stringify(await local('trusted')));}
 else check('都信任 again: the folded row is still there after 復原',false,'no .whospost-stub');
}else check('folded row present again after reload for 都信任',false,'no .whospost-stub');
check('still on the post page: our widgets never navigated',page.url().split('?')[0]===url.split('?')[0],page.url());
// ---- 回報貢獻: only the kept presses count; the switch off clears the record.
const after=await waitFor(async()=>{const r=await local('report');return r?.tally?.trusted>=2?r:null;},12000);
check('回報貢獻: two trust presses counted (the kept 都信任); the undone ones never were',after?.tally?.trusted===2&&after.tally.pages>=2,JSON.stringify(after?.tally));
// ---- 即時查 (§4.3): a press on the hover control beside an unchecked account; scanning → 快篩 → full result → folded;
// a failure goes back to "not checked" with a retry; the hourly limit refuses before any request.
if(apiBase){
 // Live: the first account on the page that nothing marks yet (a chip's popover offers 即時查 too, but the hover control is the path tested here).
 const rows0=(await snap()).rows.filter(r=>r.author&&r.author!==op&&!authors.includes(r.author));
 const liveUser=LIVE?[...new Set(rows0.map(r=>r.author))].find(u=>rows0.filter(r=>r.author===u).every(r=>['none','stale'].includes(r.state)&&r.icon))??null:'user08';
 const failUser=LIVE?null:'user17';
 const rowOf=u=>page.locator('div[data-pressable-container="true"]').filter({has:page.locator(`a[href^="/@${u}"]`)}).first();
 const liveState=async u=>{const s=await snap();return by(s,u)[0]??null;};
 if(liveUser){
  await dismiss();await top(rowOf(liveUser));
  const control=rowOf(liveUser).locator('.whospost-live').first();
  check(`即時查: hover control beside @${liveUser} (unchecked)`,await control.count()===1,`${await control.count()} controls`);
  if(!LIVE)check('the post author gets 即時查 too, on the main post (Felix 10-26)',await page.evaluate(()=>{const c=[...document.querySelectorAll('div[data-pressable-container="true"]')].find(c=>c.querySelector('a[href^="/@opaccount/post/FIXTURE0001"]')&&[...c.querySelectorAll('a[href^="/@"]')].some(a=>a.closest('[data-pressable-container]')===c&&/^\/@opaccount\/?$/.test(a.getAttribute('href'))));return !!c?.querySelector('.whospost-live');}),'');
  if(control&&await control.count())check('即時查 is visible without hovering (Felix 10-26)',await control.evaluate(n=>{const st=getComputedStyle(n);return st.opacity==='1'&&st.visibility!=='hidden'&&n.getBoundingClientRect().width>0;}),'');
  await control.dispatchEvent('click');await page.waitForTimeout(600);
  const s1=await snap();
  check('即時查: chip 「查詢中…」 right away, the reply itself untouched, toast says the check started',by(s1,liveUser)[0]?.chip==='grey/busy:查詢中…'&&['none','stale','info'].includes(by(s1,liveUser)[0]?.state)&&new RegExp(`正在查 @${liveUser}`).test(s1.toast??''),JSON.stringify({row:by(s1,liveUser)[0],toast:s1.toast,api:fake?.calls.slice(-4)}));
  await shot(LIVE?'live-1-scanning':'f6-live-scanning');
  // The site answers a 快篩 pass first (the fake API does for its first polls); it is not shown (Felix 10-26).
  const seen=new Set(),until=Date.now()+(LIVE?90000:8000);
  for(;Date.now()<until;){const r=await liveState(liveUser);if(r?.chip)seen.add(r.chip);if(r&&!/busy/.test(r.chip??''))break;if(fake&&fake.calls.filter(c=>c.method==='GET'&&/^\/api\/scans\//.test(c.path)).length>=3)await shot(LIVE?'live-2-quick':'f7-live-quick');await page.waitForTimeout(300);}
  check('即時查: no 快篩 in between — 「查詢中…」 until the full result (Felix 10-26)',seen.size>0&&[...seen].every(c=>!/partial|快篩/.test(c)),JSON.stringify([...seen]),{hard:!LIVE});
  const done=await waitFor(async()=>{const s=await snap();const r=by(s,liveUser)[0];return r&&!/busy|partial/.test(r.chip??'')&&(r.chip||r.state==='group')&&new RegExp(`@${liveUser} 查好了`).test(s.toast??'')?{row:r,stubs:s.stubs,toast:s.toast,pill:s.pill}:null;},LIVE?240000:20000);
  check('即時查: the full result replaces the 快篩, toast 「@xx 查好了」',!!done,JSON.stringify(done??await liveState(liveUser)),{hard:!LIVE});
  if(!LIVE)check('即時查 (fixture): 4 of 6 → folded like a list hit, 「已收起 1 則」 with its reasons',done?.row?.state==='group'&&done.stubs.some(t=>/^已收起 1 則/.test(t)&&/留言大量重複/.test(t)),JSON.stringify(done));
  await shot(LIVE?'live-3-done':'f8-live-done');
  const saved=await local('live');
  check('即時查: the result is kept locally under the account hash, with its scan id, nothing else about the account',!!saved?.[sha(liveUser)]?.entry?.scanId&&!JSON.stringify(saved).includes(liveUser),JSON.stringify(saved??null).slice(0,300),{hard:!LIVE});
  if(!LIVE){
   const aiSaved=await waitFor(async()=>{const v=(await local('live'))?.[sha(liveUser)]?.entry?.ai;return v?.summary?v:null;},20000);
   check('即時查 then its AI judgement (Felix 10-26): read from /api/scans/:id/ai after the result, kept with it, account name cut out',aiSaved?.summary==='該帳號 在同一串十秒內連留三則幾乎相同的回覆。'&&aiSaved.version==='claude-sonnet-5-5'&&fake.polls[`ai:${SCAN_ID}`]>=2&&!JSON.stringify(await local('live')).includes(liveUser),JSON.stringify({aiSaved,polls:fake.polls}));
   check('即時查: exactly one POST /api/scans, from the extension origin, carrying only the profile URL, no cookie',fake.calls.filter(c=>c.method==='POST'&&c.path==='/api/scans').length===1&&fake.calls.some(c=>c.method==='POST'&&c.path==='/api/scans'&&c.origin===`chrome-extension://${extId}`&&c.body===JSON.stringify({url:'https://www.threads.com/@user08'})&&c.cookie===null),JSON.stringify(fake.calls.filter(c=>c.path==='/api/scans')));
   check('即時查: the status route was polled until completed, by scan id only',fake.polls[SCAN_ID]>=4&&!fake.calls.some(c=>c.path.includes('user08')),JSON.stringify(fake.polls));
   await popup.reload();await popup.waitForTimeout(600);
   check('popup: 已查詢 1; the 即時查 meter says 1/10 and 還剩 9 次',await popup.innerText('#d-queried')==='1'&&await popup.innerText('#liveRight')==='1/10'&&/還剩 9 次/.test(await popup.innerText('#liveLine')),`${await popup.innerText('#dashboard')} | ${await popup.innerText('#liveMeter')}`);
   // Reload: the saved result draws without another request.
   const posts=fake.calls.length;
   await page.reload({waitUntil:'domcontentloaded'});await page.waitForTimeout(3000);
   const again=await liveState(liveUser);
   check('即時查: after a reload the saved result still folds the reply, with no new scan request',again?.state==='group'&&fake.calls.filter(c=>c.method==='POST'&&c.path==='/api/scans').length===1,JSON.stringify({again,calls:fake.calls.length-posts}));
  }
 }
 if(failUser){
  await top(rowOf(failUser));
  await rowOf(failUser).locator('.whospost-live').first().dispatchEvent('click');
  // The toast is shown at once; the chip leaves on the next scan (an idle callback), so wait for both.
  const failed=await waitFor(async()=>{const s=await snap();const r=by(s,failUser)[0];return new RegExp(`@${failUser} 查詢失敗`).test(s.toast??'')&&!r?.chip?{row:r,toast:s.toast}:null;},15000);
  check('即時查 failure: toast 「@xx 查詢失敗：…」 with 再試一次, the account stays unchecked (no chip, control back), never 0 hits',failed&&!failed.row?.chip&&['none','stale'].includes(failed.row?.state)&&failed.row?.icon&&/再試一次/.test(failed.toast)&&/取數失敗/.test(failed.toast),JSON.stringify(failed??await liveState(failUser)));
  await page.waitForTimeout(5500);
  // The hourly limit: ten starts already this hour → refused locally, no request leaves.
  const before=fake.calls.filter(c=>c.method==='POST'&&c.path==='/api/scans').length;
  await popup.evaluate(async()=>{await chrome.storage.local.set({liveUsage:{stamps:Array.from({length:10},(_,i)=>Date.now()-i*60000)}});});
  await rowOf(failUser).locator('.whospost-live').first().dispatchEvent('click');await page.waitForTimeout(800);
  const limited=await snap();
  const limitLabel=await rowOf(failUser).locator('.whospost-live .whospost-live-label').first().innerText().catch(()=>'');
  check('AI 打詐 used up (Felix 10-27): toast 「這小時的 AI 打詐額度用完了，HH:MM 恢復；先用「查詢背景」」, nothing sent, the control turns into 查詢背景 for that account',/這小時的 AI 打詐額度用完了，\d\d:\d\d 恢復；先用「查詢背景」/.test(limited.toast??'')&&fake.calls.filter(c=>c.method==='POST'&&c.path==='/api/scans').length===before&&!by(limited,failUser)[0]?.chip&&['查詢背景','讀取中…','讀不到背景'].includes(limitLabel),JSON.stringify({toast:limited.toast,limitLabel,row:by(limited,failUser)[0]}));
  const otherLabels=await page.locator('.whospost-live .whospost-live-label').allInnerTexts();
  check('AI 打詐 used up: every unchecked account offers 查詢背景, none AI 打詐',otherLabels.length>0&&!otherLabels.includes('AI 打詐'),JSON.stringify(otherLabels));
  // 查詢背景 then asks the site only for a saved result (Felix 10-27): one savedOnly POST, no allowance counted.
  await rowOf(failUser).locator('.whospost-live').first().dispatchEvent('click');await page.waitForTimeout(800);
  const savedCalls=fake.calls.filter(c=>c.method==='POST'&&c.path==='/api/scans'&&/"savedOnly":true/.test(c.body??''));
  check('查詢背景 with AI 打詐 used up: one savedOnly request carrying only the profile URL, nothing new started, the allowance untouched',savedCalls.length===1&&JSON.stringify(Object.keys(JSON.parse(savedCalls[0].body)))==='["url","savedOnly"]'&&(await popup.evaluate(async()=>(await chrome.storage.local.get('liveUsage')).liveUsage?.stamps?.length))===10,JSON.stringify(savedCalls));
  await popup.reload();await popup.waitForTimeout(500);
  check('popup: the 即時查 meter says the hour is used up',await popup.innerText('#liveRight')==='10/10'&&/這小時用完了/.test(await popup.innerText('#liveLine'))&&await popup.locator('#liveMeter[data-level="full"]').count()===1,await popup.innerText('#liveMeter'));
  await popup.evaluate(async()=>{await chrome.storage.local.remove('liveUsage');});
 }
}
// ---- 封鎖助手 and 檢舉 (EXTENSION-SPEC §4.5), fixture only: the switch from /api/health; the popover buttons; a block
// press clicks that reply's ⋯ → Block → Block once each on the same page (fixture/reply-menu.js); 8 s cooldown in every
// popover; the blocked account is no longer marked; a menu without Block stops after the ⋯; 檢舉 stops at the report
// window; the switch off hides the buttons.
if(!LIVE){
 const chipOf=u=>page.locator('div[data-pressable-container="true"]').filter({has:page.locator(`a[href^="/@${u}"]`)}).first().locator('.whospost-chip:not(.whospost-chip-static)').first();
 const openPop=async u=>{await dismiss();const c=chipOf(u);await top(c);await c.click();await page.waitForTimeout(500);return (await snap()).popover??'';};
 const blockBtn=()=>page.locator('.whospost-pop .whospost-btn-block');
 const flags=await waitFor(async()=>{const f=await local('flags');return f?.block===true?f:null;},8000);
 check('封鎖助手: the switch is read from /api/health (extension.block) and kept locally',flags?.block===true&&Number.isFinite(flags.fetchedAt),JSON.stringify(flags));
 const pop=await openPop('user03');
 const btnLabels=await page.locator('.whospost-pop .whospost-pop-btns:not(.whospost-pop-cta) > *').allInnerTexts();
 check('封鎖助手 (Felix 10-26): outlined 「封鎖此用戶」 and 「檢舉此用戶」 side by side (Felix 10-27), the filled 「看完整證據」 alone at the very bottom; no block explanation',JSON.stringify(btnLabels)===JSON.stringify(['封鎖此用戶','檢舉此用戶'])&&await page.locator('.whospost-pop .whospost-btn-block:not(.whospost-btn-primary) + .whospost-btn-report:not(.whospost-btn-primary)').count()===1&&await page.locator('.whospost-pop > .whospost-pop-cta:last-child > .whospost-btn-primary').innerText().catch(()=>'')==='看完整證據'&&!(await blockBtn().isDisabled())&&!/到 Threads 封鎖|封鎖是你的決定|每次間隔 8 秒/.test(pop),JSON.stringify({btnLabels,pop}));
 check('popover with an AI summary: 「@user03」 alone with its reason chip on the same line, the AI part right under it, then the buttons',await page.locator('.whospost-pop .whospost-pop-title').innerText()==='@user03'&&JSON.stringify(await page.locator('.whospost-pop .whospost-pop-head .whospost-chip').allInnerTexts())===JSON.stringify(['留言大量重複'])&&await page.locator('.whospost-pop .whospost-pop-head + .whospost-pop-ai + .whospost-pop-btns').count()===1&&await page.locator('.whospost-pop .whospost-pop-note').count()===0,pop);
 check('popover: the AI part has no heading — the list\'s summary, then one line 「Claude 判讀，僅供參考」 (Felix 10-26) for the fallback model',!/AI 判讀/.test(pop)&&await page.locator('.whospost-pop .whospost-pop-ai-text').innerText()===AI_SUMMARY&&await page.locator('.whospost-pop .whospost-pop-ai-source').innerText()==='Claude 判讀，僅供參考'&&!/項檢查中|查於|清單 \d+\/\d+ 版/.test(pop),pop);
 if(!LIVE){const row=page.locator('div[data-pressable-container="true"]').filter({has:page.locator('a[href^="/@user03"]')}).first();
  check('background from the list (Felix 10-27): user03 shows 🇺🇸 and its joined age without any read, and the popover says other users read it',/🇺🇸/.test(await row.locator('.whospost-bg-flag').first().innerText().catch(()=>''))&&/年前加入/.test(await row.locator('.whospost-bg-age').first().innerText().catch(()=>''))&&/其他使用者讀到的（2 個網路位置回報）/.test(pop)&&/美國/.test(pop),pop.slice(0,400));}
 check('popover: no 信任 button, no 申訴 link, no old disclaimer',!/信任這個帳號|申訴或要求刪除|這不是身分判定/.test(pop),pop);
 check('封鎖助手: no block button on chips or folded rows',await page.locator('.whospost-chip .whospost-btn-block, .whospost-stub .whospost-btn-block').count()===0&&!/封鎖/.test((await snap()).stubs.join(' ')),'');
 // A toast left from the 即時查 steps above has nothing to do with this shot.
 await page.evaluate(()=>document.querySelector('.whospost-toast')?.remove());
 await page.screenshot({path:path.join(OUT,'f9-block-popover.png')});
 const presses=async()=>page.evaluate(()=>[...window.__presses]);
 const pagesBefore=ctx.pages().length,pressedAt=Date.now();
 await blockBtn().click();
 const doneToast=await waitFor(async()=>{const t=(await snap()).toast??'';return /已封鎖 @user03/.test(t)?t:null;},10000);
 check('封鎖助手 (Felix 10-26): on the post page itself, no new tab — user03\'s own ⋯ → Block → Block, each pressed once, in order',JSON.stringify(await presses())===JSON.stringify(['more:user03','menu:Block','confirm:Block'])&&ctx.pages().length===pagesBefore,JSON.stringify({presses:await presses(),pages:ctx.pages().length}));
 check('封鎖助手: then a toast 「已封鎖 @user03」',!!doneToast,(await snap()).toast);
 await page.screenshot({path:path.join(OUT,'f10-block-done.png')});
 const blocked=await local('blocked');
 check('封鎖助手: the account is on the local blocked list (hash → username)',blocked?.[sha('user03')]?.username==='user03'&&Object.keys(blocked).length===1,JSON.stringify(blocked));
 const after=await waitFor(async()=>{const r=by(await snap(),'user03')[0];return r?.state==='blocked'?r:null;},6000);
 check('封鎖助手: the blocked account is no longer marked (no chip, no 即時查)',after&&!after.chip&&!after.icon,JSON.stringify(after??by(await snap(),'user03')[0]));
 // Still inside the 8 seconds: another account's button is grey and does nothing.
 const pop4=await openPop('user04');
 check('封鎖助手: during the cooldown every block button is grey with the countdown',/秒後才能再封鎖/.test(pop4)&&await blockBtn().isDisabled(),pop4);
 const n4=(await presses()).length;
 await blockBtn().click({force:true}).catch(()=>{});await page.waitForTimeout(800);
 check('封鎖助手: pressing a grey button presses nothing on the page',(await presses()).length===n4,JSON.stringify(await presses()));
 await waitFor(async()=>!(await blockBtn().isDisabled())?true:null,12000);
 check('封鎖助手: the button comes back after 8 seconds',!(await blockBtn().isDisabled())&&await blockBtn().innerText()==='封鎖此用戶'&&Date.now()-pressedAt>=8000,await blockBtn().innerText());
 // The layout changed: user04's menu has no Block. The run stops after the ⋯ and presses nothing else.
 await blockBtn().click();
 const stopped=await waitFor(async()=>{const t=(await snap()).toast??'';return /^Threads 版面已變/.test(t)?t:null;},10000);
 check('封鎖助手: no Block in the menu → 「Threads 版面已變，請自己按（停在：「⋯」選單裡找不到「封鎖」）」',/^Threads 版面已變，請自己按（停在：「⋯」選單裡找不到「封鎖」）/.test(stopped??''),stopped);
 check('封鎖助手: after a stop nothing else was pressed and the account is not on the list',JSON.stringify((await presses()).slice(n4))==='["more:user04"]'&&!(await local('blocked'))?.[sha('user04')],JSON.stringify(await presses()));
 // The user closes the menu the stopped run left open.
 await page.evaluate(()=>window.__closeMenu());
 // 檢舉 (Felix 10-26): ⋯ → Report opens Threads' report window and stops there; no reason is pressed.
 await openPop('user04');
 const n5=(await presses()).length;
 await page.locator('.whospost-pop .whospost-btn-report').click();
 await waitFor(async()=>await page.locator('.fx-report [role=dialog]').count()?true:null,10000);await page.waitForTimeout(600);
 const reportToast=(await snap()).toast??'';
 check('檢舉: user04\'s own ⋯ → Report, the report window is open, no reason pressed, no toast of ours (Felix 10-27: the window says it)',JSON.stringify((await presses()).slice(n5))===JSON.stringify(['more:user04','menu:Report'])&&await page.locator('.fx-report [role=dialog]').count()===1&&!/檢舉/.test(reportToast),JSON.stringify({presses:await presses(),reportToast}));
 await page.screenshot({path:path.join(OUT,'f11-report-open.png')});
 await page.evaluate(()=>document.querySelector('.fx-report')?.remove());
 check('檢舉: nothing about it is stored, the account is not blocked',!(await local('blocked'))?.[sha('user04')],'');
 // The popup: 已封鎖 counts the local list (Felix 10-26: no list in the popup any more).
 await popup.reload();await popup.waitForTimeout(600);
 check('popup dashboard: 已封鎖 1',await popup.innerText('#d-blocked')==='1',await popup.innerText('#dashboard'));
 // The switch off at the site: the next refresh turns it off and the popover has no block button.
 fakeFlags.block=false;
 await popup.evaluate(()=>new Promise(r=>chrome.runtime.sendMessage({type:'refreshList'},()=>{void chrome.runtime.lastError;r();})));
 const off=await waitFor(async()=>{const f=await local('flags');return f?.block===false?f:null;},6000);
 await page.waitForTimeout(300);
 const popOff=await openPop('user04');
 check('封鎖助手 switch off: no block button in the popover',off?.block===false&&await blockBtn().count()===0&&!/封鎖此用戶/.test(popOff),popOff);
 fakeFlags.block=true;await page.keyboard.press('Escape');
 // Taking an account off the local list (the popup no longer can; storage still can) lets Whospost mark it again.
 await popup.evaluate(async()=>{await chrome.storage.local.set({blocked:{}});});await popup.waitForTimeout(600);
 const back=await waitFor(async()=>{const r=by(await snap(),'user03')[0];return r&&r.state!=='blocked'&&r.chip?r:null;},6000);
 check('off the blocked list: the account is marked again on the post page',!!back,JSON.stringify(by(await snap(),'user03')[0]));
}
await popup.reload();await popup.waitForTimeout(500);
// 回報貢獻 has no switch in the popup any more (Felix 10-26); a saved 'report:false' still stops it.
const setSetting=patch=>popup.evaluate(async p=>{const s=(await chrome.storage.sync.get('settings')).settings??{};await chrome.storage.sync.set({settings:{...s,...p}});},patch);
await setSetting({report:false});await popup.evaluate(()=>new Promise(r=>chrome.runtime.sendMessage({type:'tally',delta:null},()=>{void chrome.runtime.lastError;r();})));await popup.waitForTimeout(400);
check('回報貢獻 off (saved setting): the local record is cleared',(await local('report'))===undefined,JSON.stringify(await local('report')));
await setSetting({report:true});
// ---- Fixture only: 帳號背景 (§4.4) on a signed-in copy of the page: the three tokens in an inline script and the two
// cookies a signed-in Threads page has; Threads' two answers are the unit tests' fixtures, served by routing. user07
// joined this month, so its 「本串 5 則」 chip gets 新帳號; everyone else joined in 2024. Then the remote switch, the stop
// rule (403 three times) and the popup switch. Nothing of it may reach the fake Whospost API.
if(!LIVE){
 const P=await import('../fixtures/profile.mjs');
 const SIGNED=FIXTURE_URL.replace('FIXTURE0001','FIXTURE0003');
 const signedHtml=fixtureHtml.replace('</body>',`<script type="application/json">${P.pageScripts()}</script></body>`);
 const taipei=new Date(Date.now()+8*3600000),ym=`${taipei.getUTCFullYear()}-${String(taipei.getUTCMonth()+1).padStart(2,'0')}`;
 const asks=[],pkUser=new Map();let refuse=false;
 const pkOf=u=>String(7000000+[...u].reduce((n,c)=>(n*31+c.charCodeAt(0))%1000000,0));
 await ctx.route(u=>u.href.split('?')[0]===SIGNED,route=>route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:signedHtml}));
 await ctx.route(u=>u.origin==='https://www.threads.com'&&['/graphql/query','/async/wbloks/fetch/'].includes(u.pathname),async route=>{
  const req=route.request(),body=new URLSearchParams(req.postData()??''),card=new URL(req.url()).pathname==='/graphql/query';
  const name=card?body.get('fb_api_req_friendly_name'):null,vars=card?JSON.parse(body.get('variables')??'{}'):{};
  // Any other GraphQL query (the friendships dialog's counts or 追蹤中 list, say) is recorded as 'other': none may be sent.
  const kind=!card?'about':name==='BarcelonaUsernameHovercardImplDirectQuery'?'card':'other';
  const username=kind==='card'?vars.username??null:null,target=card?null:JSON.parse(body.get('params')??'{}').target_user_id??null;
  asks.push({at:Date.now(),kind,name,username,target,csrf:req.headers()['x-csrftoken']??null,lsd:req.headers()['x-fb-lsd']??null,dtsg:body.get('fb_dtsg')});
  if(refuse)return route.fulfill({status:403,body:''});
  if(kind==='other')return route.fulfill({status:500,body:''});
  if(card){pkUser.set(pkOf(username),username);return route.fulfill({status:200,contentType:'text/javascript',body:P.hovercard({username,pk:pkOf(username),followers:username==='user07'?12:1234})});}
  const who=pkUser.get(target);
  return route.fulfill({status:200,contentType:'text/javascript',body:P.about({joined:who==='user07'?`${taipei.getUTCFullYear()}年${taipei.getUTCMonth()+1}月 · #401,000,000`:'2024年3月 · #120,000,000',country:'台灣'})});
 });
 await ctx.addCookies([{name:'ds_user_id',value:'42',domain:'.threads.com',path:'/'},{name:'csrftoken',value:'CSRFfixture',domain:'.threads.com',path:'/'}]);
 await popup.evaluate(async()=>{await chrome.storage.local.remove(['profiles','profileUsage','profileBreaker']);});
 const apiCalls=fake.calls.length;
 await page.goto(SIGNED,{waitUntil:'domcontentloaded'});await page.waitForTimeout(2500);
 const bgSnap=()=>page.evaluate(()=>{const own=c=>[...c.querySelectorAll('a[href^="/@"]')].find(a=>a.closest('[data-pressable-container]')===c&&/^\/@[^/]+\/?$/.test(a.getAttribute('href')))?.getAttribute('href').replace(/^\/@/,'').replace(/\/$/,'').toLowerCase()??null;return [...document.querySelectorAll('div[data-pressable-container="true"]')].map(c=>({author:own(c),chip:c.querySelector('.whospost-chip:not(.whospost-chip-static)')?.textContent??null,line:c.querySelector('.whospost-bg-place')?.textContent??null,title:c.querySelector('.whospost-bg-place')?.title??null,flag:!!c.querySelector('.whospost-bg-flag'),age:c.querySelector('.whospost-bg-age')?.textContent??null,isNew:!!c.querySelector('.whospost-bg-new')})).filter(r=>r.chip);});
 // Accounts the user trusted earlier in this run keep their 「已信任」 chip and are not looked up.
 const signedRows=await bgSnap(),trustedAuthors=[...new Set(signedRows.filter(r=>r.chip==='已信任').map(r=>r.author))];
 // user03's background is on the list (reported by others, Felix 10-27): shown, never read here.
 const shownFromList=[...new Set(signedRows.filter(r=>r.chip!=='已信任').map(r=>r.author))],chipAuthors=shownFromList.filter(u=>u!=='user03');
 console.log('BG chip authors',chipAuthors.join(','),'trusted',trustedAuthors.join(','));
 check('帳號背景: the signed-in page has chips to look up, user07 among them',chipAuthors.length>=3&&chipAuthors.includes('user07'),chipAuthors.join(','));
 const rowOf=u=>page.locator('div[data-pressable-container="true"]').filter({has:page.locator(`a[href^="/@${u}"]`)}).first();
 // Only authors on screen are read: bring each into view in turn and wait for its two requests.
 for(const u of chipAuthors){await top(rowOf(u));await waitFor(async()=>asks.filter(a=>a.username===u||pkUser.get(a.target)===u).length>=2,12000);}
 await page.waitForTimeout(800);
 const lines=await bgSnap(),first=u=>lines.find(r=>r.author===u);
 console.log('BG',JSON.stringify(lines.map(r=>[r.author,r.line,r.isNew])));
 // Felix 10-24: beside the name only the place, as a flag with the full name as its title; the joined month is in the popover.
 check('帳號背景: the place beside each name as a flag 🇹🇼 titled 「台灣」, then 「N 年前加入」 (fixture joined 2024年3月; Felix 10-26); no follower or following count',chipAuthors.filter(u=>u!=='user07').every(u=>first(u)?.line==='🇹🇼'&&first(u).title==='台灣'&&first(u).flag&&/^\d+ 年前加入$/.test(first(u).age??'')&&!first(u).isNew),JSON.stringify(lines));
 check('帳號背景 from the list: user03 shows 🇺🇸 and is never asked for',first('user03')?.line==='🇺🇸'&&!asks.some(a=>a.username==='user03'),JSON.stringify(first('user03')));
 check('帳號背景: user07 (joined this month, 本串 5 則) → the flag, then 「近 1 個月加入」 marked new (新帳號不等於假帳號 on hover)',first('user07')?.isNew&&first('user07')?.line==='🇹🇼'&&first('user07')?.age==='近 1 個月加入'&&first('user07')?.chip==='本串 5 則',JSON.stringify(first('user07')));
 check('帳號背景: two requests per author (hover card by name, then the dialog by its id), with the page\'s tokens',chipAuthors.every(u=>asks.filter(a=>a.kind==='card'&&a.username===u).length===1&&asks.filter(a=>a.kind==='about'&&pkUser.get(a.target)===u).length===1)&&asks.every(a=>a.csrf==='CSRFfixture'||a.kind==='about')&&asks.every(a=>a.lsd==='LSDfixture'&&a.dtsg==='DTSGfixture:1'),JSON.stringify(asks.map(a=>[a.kind,a.username??a.target,a.csrf])));
 // The slot is per account (Felix 10-26): hover cards 2 s apart; each account's dialog read follows its card at once.
 const cards=asks.filter(a=>a.kind==='card'),gaps=cards.slice(1).map((a,i)=>a.at-cards[i].at);
 check('帳號背景: at most one account every 2 seconds',gaps.every(g=>g>=1900),JSON.stringify(gaps));
 check('帳號背景: trusted accounts are not looked up and get no line',trustedAuthors.length>=1&&trustedAuthors.every(u=>!asks.some(a=>a.username===u)&&!first(u)?.line),JSON.stringify({trustedAuthors,lines:trustedAuthors.map(first)}));
 const cache=await local('profiles');
 check('帳號背景: kept in this browser\'s storage for each author (joined, country), no follower count',chipAuthors.every(u=>cache?.[u]?.data?.joined&&cache[u].data.country==='台灣'&&!('followers' in cache[u].data)&&Number.isFinite(cache[u].at)),JSON.stringify(cache).slice(0,300));
 await top(rowOf('user07'));await mask();await page.screenshot({path:path.join(OUT,'f9-profile-line.png')});
 await rowOf('user07').locator('.whospost-chip:not(.whospost-chip-static)').first().click();await page.waitForTimeout(1500);
 const pop=(await snap()).popover??'';
 // Felix 10-24: no 改名 row for now (still read and cached), no source line in the popover.
 check('帳號背景 popover: 加入, 所在地點, 新帳號不等於假帳號; no 改名 row, no source line, no 粉絲 or 追蹤',/帳號背景/.test(pop)&&new RegExp(`加入\\s*${Number(ym.slice(0,4))}年${Number(ym.slice(5))}月`).test(pop)&&/所在地點\s*台灣/.test(pop)&&!/改名/.test(pop)&&!/粉絲|追蹤/.test(pop.slice(pop.indexOf('帳號背景')))&&!/由 Threads 顯示/.test(pop)&&/新帳號不等於假帳號/.test(pop),pop);
 check('帳號背景: no other Threads query is sent (no follower counts, no 追蹤中 list), not even after the popover opened',!asks.some(a=>a.kind==='other'),JSON.stringify(asks.filter(a=>a.kind==='other').map(a=>a.name)));
 const sentToSite=fake.calls.slice(apiCalls);
 check('帳號背景: nothing of it goes to Whospost (no name, no value, no request beyond the usual ones)',!sentToSite.some(c=>chipAuthors.some(u=>`${c.path} ${c.body??''}`.includes(u))||/台灣|joined|follow|profile/i.test(`${c.path} ${c.body??''}`)),JSON.stringify(sentToSite.map(c=>c.path)));
 await shot('f10-profile-popover',{hide:false});
 await page.keyboard.press('Escape');
 // A reload reads the 7-day cache: no request.
 const n0=asks.length;await page.reload({waitUntil:'domcontentloaded'});await page.waitForTimeout(2500);
 check('帳號背景: after a reload the lines come from the cache, no request',asks.length===n0&&(await bgSnap()).some(r=>r.line),`${asks.length-n0} new requests`);
 // 「AI 打詐」 on an unchecked account (Felix 10-27): its background is read even off screen and sent to the site once,
 // by scan ID, as a code and a month; the account name goes only in the scan request itself.
 const before=fake.calls.length;
 await top(rowOf('user17'));await rowOf('user17').locator('.whospost-live').first().dispatchEvent('click');
 const sent=await waitFor(async()=>fake.calls.slice(before).find(c=>c.method==='POST'&&c.path==='/api/list/v1/profile')??null,15000);
 check('AI 打詐 sends the background it read: one POST /api/list/v1/profile with the scan id, TW and 2024-03, no name',!!sent&&sent.body===JSON.stringify({scanId:FAIL_ID,country:'TW',place:null,joined:'2024-03'})&&fake.calls.slice(before).filter(c=>c.path==='/api/list/v1/profile').length===1,JSON.stringify(fake.calls.slice(before).map(c=>[c.path,c.body])));
 await page.waitForTimeout(2500);
 const n0b=asks.length;
 // The remote switch (/api/health → extension.profileLookup, read about once an hour): off → nothing is read.
 await popup.evaluate(async()=>{await chrome.storage.local.remove('profiles');await chrome.storage.local.set({profileFlag:{on:false,checkedAt:Date.now()}});});
 await page.reload({waitUntil:'domcontentloaded'});await page.waitForTimeout(3500);
 await top(rowOf('user07'));await rowOf('user07').locator('.whospost-chip:not(.whospost-chip-static)').first().click();await page.waitForTimeout(400);
 const offPop=(await snap()).popover??'';
 check('帳號背景 remote switch off: no request, the popover says Whospost turned it off, no line (not even the list\'s)',asks.length===n0b&&/Whospost 暫時關閉了這個功能/.test(offPop)&&!(await bgSnap()).some(r=>r.line),`${asks.length-n0b} requests | ${offPop.slice(-80)}`);
 await page.keyboard.press('Escape');
 // The stop rule: three refusals in a row → 「帳號背景暫停」 in the pill; nothing more is asked. The tab leaves the page
 // before the switch comes back on: an open page would start reading at once, and its last request could still be in
 // flight when the reload replaces it (CI 10-24: four requests, three counted).
 await page.goto('about:blank');
 refuse=true;const n1=asks.length;
 await popup.evaluate(async()=>{await chrome.storage.local.remove(['profiles','profileUsage','profileBreaker']);await chrome.storage.local.set({profileFlag:{on:true,checkedAt:Date.now()}});});
 await page.goto(SIGNED,{waitUntil:'domcontentloaded'});await page.waitForTimeout(1500);
 for(const u of chipAuthors){await top(rowOf(u));await page.waitForTimeout(2300);if(asks.length-n1>=3)break;}
 const pausedSnap=await waitFor(async()=>{const s=await snap();return /帳號背景暫停/.test(s.pill??'')?s:null;},8000);
 await page.waitForTimeout(2500);
 const breaker=await local('profileBreaker');
 check('帳號背景 stop rule: three 403s in a row → pill 「帳號背景暫停」, no fourth request',!!pausedSnap&&asks.length-n1===3&&breaker?.reason==='refused'&&Number.isFinite(breaker.pausedAt),JSON.stringify({pill:pausedSnap?.pill??(await snap()).pill,requests:asks.length-n1,breaker}));
 await shot('f11-profile-paused');
 await popup.reload();await popup.waitForTimeout(600);
 check('popup: says 帳號背景暫停 and why',/帳號背景暫停/.test(await popup.innerText('#profileLine'))&&/被拒絕/.test(await popup.innerText('#profileLine')),await popup.innerText('#profileLine'));
 // No switch in the popup any more (Felix 10-26). Clearing the pause (what turning it off and on used to do) takes
 // the pill off the page.
 await popup.evaluate(async()=>{await chrome.storage.local.remove('profileBreaker');});
 await page.waitForTimeout(800);
 check('pause cleared: the pill leaves the page',!/帳號背景暫停/.test((await snap()).pill??''),(await snap()).pill);
 refuse=false;await ctx.clearCookies();
}
// ---- Fixture only: the layout-changed path (§6.3 health check) and the dom_broken notice.
if(!LIVE){
 await page.goto(FIXTURE_URL.replace('FIXTURE0001','FIXTURE0002'),{waitUntil:'domcontentloaded'});
 // Three scans in a row must agree (BROKEN_SCANS); a static page only scans on load, so nudge the observer.
 for(let i=0;i<5;i++){await page.evaluate(()=>document.body.append(document.createElement('div')));await page.mouse.wheel(0,300);await page.waitForTimeout(700);}
 const broken=await waitFor(async()=>{const s=await snap();return s.health==='broken'?s:null;},10000);
 check('layout changed: pill says 「Threads 版面已變，等待更新」 and nothing is marked',broken?.pill==='Threads 版面已變，等待更新'&&broken.rows.every(r=>!r.state&&!r.chip),JSON.stringify({pill:broken?.pill,health:broken?.health}));
 await popup.reload();await popup.waitForTimeout(600);
 check('popup shows the layout-changed status',/Threads 版面已變/.test(await popup.innerText('#status')),await popup.innerText('#status'));
 const rep=await waitFor(async()=>{const r=await local('report');return r?.brokenDay?r:null;},6000);
 check('dom_broken: one notice a day, marked locally with the Taipei day',rep?.brokenDay===today(),JSON.stringify(rep));
 await page.screenshot({path:path.join(OUT,'f5-layout-changed.png')});
}
}catch(e){check('harness ran to the end',false,e?.stack??String(e),{hard:true});}
const errors=logs.filter(l=>/^\[(error|pageerror)\]/.test(l)&&/whospost|chrome-extension/.test(l));
check('no extension errors in the page console',errors.length===0,errors.join(' || '));
console.log('LOGS',JSON.stringify(logs.slice(0,20)));
fs.writeFileSync(path.join(OUT,'result.json'),JSON.stringify({mode:LIVE?'live':'fixture',url,extId,failed,results,logs},null,1));
await ctx.close();await fake?.close();
console.log(failed?`\n${failed} check(s) failed`:'\nall checks passed');
process.exit(failed?1:0);
