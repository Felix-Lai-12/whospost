// Loads extension/ into Playwright's Chromium (new headless, extensions allowed), opens a real logged-out Threads
// post page and records what the extension drew. Phase 1: production list API is off (404) → graceful degradation.
// Phase 2: seed a local list cache with two accounts seen on the page → list-hit bar, fade, why card, popup.
import {createHash} from 'node:crypto';
import fs from 'node:fs';
// Needs Playwright with its Chromium build (npx playwright install chromium); not part of npm test.
const {chromium}=await import('playwright');
const EXT=new URL('../',import.meta.url).pathname.replace(/\/$/,'');
const OUT=process.env.OUT||'./shots'; // run from a scratch folder: node extension/docs/e2e-playwright.mjs [post url]
const POST=process.argv[2]||'https://www.threads.com/@meta/post/DezZbXvEpqd';
const profile=`${OUT}/../profile-${Date.now()}`;
const sha=t=>createHash('sha256').update(t).digest('hex');
const ctx=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,locale:'zh-TW',viewport:{width:1280,height:900},args:[`--disable-extensions-except=${EXT}`,`--load-extension=${EXT}`]});
let sw=ctx.serviceWorkers()[0]||await ctx.waitForEvent('serviceworker');
const extId=new URL(sw.url()).host;
console.log('extension id',extId);
const logs=[];
const page=await ctx.newPage();
page.on('console',m=>{if(/whospost/i.test(m.text())||m.type()==='error')logs.push(`[${m.type()}] ${m.text().slice(0,300)}`);});
page.on('pageerror',e=>logs.push(`[pageerror] ${String(e).slice(0,300)}`));
const popup=await ctx.newPage();await popup.goto(`chrome-extension://${extId}/popup.html`);
// wait for the first list fetch attempt (404 in production) to be recorded
for(let i=0;i<40;i++){const l=await popup.evaluate(()=>chrome.storage.local.get('list').then(r=>r.list));if(l&&(l.failedAt||l.fetchedAt)){console.log('list cache after first fetch:',JSON.stringify({...l,accounts:Array.isArray(l.accounts)?l.accounts.length:l.accounts}));break;}await popup.waitForTimeout(250);}
await page.goto(POST,{waitUntil:'domcontentloaded',timeout:60000});
await page.waitForTimeout(6000);
for(let i=0;i<2;i++){await page.mouse.wheel(0,900);await page.waitForTimeout(1200);}
const snap=async()=>page.evaluate(()=>{const cs=[...document.querySelectorAll('div[data-pressable-container="true"]')];return {containers:cs.length,states:cs.map(c=>c.getAttribute('data-whospost')),bars:[...document.querySelectorAll('.whospost-bar')].map(b=>b.querySelector('.whospost-bar-text')?.textContent),icons:document.querySelectorAll('.whospost-icon').length,pill:document.querySelector('.whospost-pill')?.textContent,theme:document.documentElement.getAttribute('data-whospost-theme'),authors:cs.map(c=>[...c.querySelectorAll('a[href^="/@"]')].find(a=>a.closest('[data-pressable-container]')===c&&/^\/@[^/]+\/?$/.test(a.getAttribute('href')))?.getAttribute('href'))};});
const phase1=await snap();console.log('PHASE1',JSON.stringify(phase1));
await page.keyboard.press('Escape');await page.waitForTimeout(300);await page.evaluate(()=>{for(const d of document.querySelectorAll('[role=dialog]')){let n=d;while(n.parentElement&&n.parentElement!==document.body&&!n.parentElement.querySelector('[data-pressable-container]'))n=n.parentElement;n.style.display='none';}});await page.waitForTimeout(200);await page.screenshot({path:`${OUT}/1-degraded-404.png`});
// Phase 2: seed a list with two non-OP authors from this very page (score 4 and score 1)
const op=new URL(POST).pathname.match(/^\/@([^/]+)/)[1].toLowerCase();
const authors=[...new Set(phase1.authors.filter(Boolean).map(h=>h.replace(/^\/@/,'').replace(/\/$/,'').toLowerCase()))].filter(a=>a!==op);
console.log('non-OP authors',authors);
const entries=[];
if(authors[0])entries.push({h:sha(authors[0]),score:4,hits:['content-comments','thread-focus','author-focus','burst-replies'],assessed:5,unknown:1,evidence:'rules',ai:{summary:'該帳號的留言多為短句且高度重複，集中出現在同幾篇貼文下。',version:'fixture'},scanId:'fixture-scan-1',updated:'2026-10-20T03:00:00Z',appeals:0});
if(authors[1])entries.push({h:sha(authors[1]),score:1,hits:['content-comments'],assessed:4,unknown:2,evidence:'rules',ai:null,scanId:'fixture-scan-2',updated:'2026-10-18T03:00:00Z',appeals:2});
await popup.evaluate(async({entries})=>{await chrome.storage.local.set({list:{version:'signals-v2',accounts:entries,generated:new Date().toISOString(),etag:'"fixture"',fetchedAt:Date.now(),failedAt:null,failure:null}});},{entries});
await page.waitForTimeout(2500);
const phase2=await snap();console.log('PHASE2',JSON.stringify(phase2));
const bar=page.locator('.whospost-bar').first();
// Test harness only: Threads keeps reopening its logged-out sign-in dialog; hide its fixed overlay so screenshots show the page.
const dismiss=async()=>{await page.keyboard.press('Escape');await page.waitForTimeout(300);await page.evaluate(()=>{for(const d of document.querySelectorAll('[role=dialog]')){let n=d;while(n.parentElement&&n.parentElement!==document.body&&!n.parentElement.querySelector('[data-pressable-container]'))n=n.parentElement;n.style.display='none';}});await page.waitForTimeout(200);};
const top=async loc=>{await loc.evaluate(el=>{el.scrollIntoView({block:'start'});window.scrollBy(0,-120);});await page.waitForTimeout(700);};
if(await bar.count()){await dismiss();await top(bar);await page.screenshot({path:`${OUT}/2-list-hit-bar.png`});
 await bar.locator('.whospost-bar-text').dispatchEvent('click');await page.waitForTimeout(600);await dismiss();await page.screenshot({path:`${OUT}/3-why-card.png`});
 const card=await bar.locator('.whospost-card').innerText();console.log('CARD',card.replace(/\n/g,' | ').slice(0,600));
 console.log('after card click, still on',page.url());
}
// Phase 3: thread thresholds down to 2 via the popup UI, to show the thread-observation bar if any account repeats
await popup.bringToFront();await popup.reload();await popup.waitForTimeout(500);
await popup.fill('#threadBarAt','2');await popup.dispatchEvent('#threadBarAt','change');await popup.fill('#threadSameContentAt','2');await popup.dispatchEvent('#threadSameContentAt','change');
await popup.waitForTimeout(800);
await popup.reload();await popup.waitForTimeout(700);console.log('pageStats',JSON.stringify(await popup.evaluate(()=>chrome.storage.local.get('pageStats').then(r=>r.pageStats))));await popup.screenshot({path:`${OUT}/4-popup.png`,fullPage:true});
console.log('POPUP',(await popup.innerText('body')).replace(/\n+/g,' | ').slice(0,700));
await page.waitForTimeout(2000);
const phase3=await snap();console.log('PHASE3',JSON.stringify(phase3));
const blue=page.locator('.whospost-bar.whospost-blue').first();
if(await blue.count()){await dismiss();await top(blue);await dismiss();await page.screenshot({path:`${OUT}/5-thread-observation-bar.png`});}
// trust the first flagged account from the bar and confirm the state flips
const trust=page.locator('.whospost-bar .whospost-btn',{hasText:'信任'}).first();
if(await trust.count()){await trust.dispatchEvent('click');await page.waitForTimeout(1200);const after=await snap();console.log('AFTER TRUST',JSON.stringify({states:after.states,bars:after.bars.length,pill:after.pill}));const trusted=await popup.evaluate(()=>chrome.storage.local.get('trusted').then(r=>r.trusted));console.log('trusted store',JSON.stringify(trusted));}
console.log('LOGS',JSON.stringify(logs,null,0).slice(0,1500));
fs.writeFileSync(`${OUT}/result.json`,JSON.stringify({extId,phase1,phase2,phase3,logs},null,1));
await ctx.close();
