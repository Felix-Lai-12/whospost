// Redesign e2e: loads extension/ into Playwright's Chromium (new headless, extensions allowed), opens a real logged-out
// Threads post page and records what the extension drew. Phase 1: the production list API is off (404) → the grey
// "清單暫時無法讀取" line and no pill. Phase 2: a local list cache seeded with accounts seen on the page → the folded
// row, chips, the pill; then the popup, "顯示", the popover, "信任這個帳號" with its toast, and "復原".
import {createHash} from 'node:crypto';
import fs from 'node:fs';
// Needs Playwright with its Chromium build (npx playwright install chromium); not part of npm test.
const {chromium}=await import('playwright');
const EXT=new URL('../',import.meta.url).pathname.replace(/\/$/,'');
const OUT=process.env.OUT||'./shots'; // run from a scratch folder: node extension/docs/e2e-playwright.mjs [post url]
const POST=process.argv[2]||'https://www.threads.com/@zuck/post/DeZtp-TkQHh';
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
for(let i=0;i<40;i++){const l=await popup.evaluate(()=>chrome.storage.local.get('list').then(r=>r.list));if(l&&(l.failedAt||l.fetchedAt)){console.log('list cache after first fetch:',JSON.stringify({...l,accounts:Array.isArray(l.accounts)?l.accounts.length:l.accounts}));break;}await popup.waitForTimeout(250);}
await page.goto(POST,{waitUntil:'domcontentloaded',timeout:60000});
await page.waitForTimeout(6000);
for(let i=0;i<2;i++){await page.mouse.wheel(0,900);await page.waitForTimeout(1200);}
// Test harness only: Threads keeps reopening its logged-out sign-in dialog; hide that subtree so screenshots show the page.
const dismiss=async()=>{await page.keyboard.press('Escape');await page.waitForTimeout(300);await page.evaluate(()=>{for(const d of document.querySelectorAll('[role=dialog]')){if(d.classList.contains('whospost-pop'))continue;let n=d;while(n.parentElement&&n.parentElement!==document.body&&!n.parentElement.querySelector('[data-pressable-container]'))n=n.parentElement;n.style.display='none';}});await page.waitForTimeout(200);};
const top=async loc=>{await loc.evaluate(el=>{el.scrollIntoView({block:'start'});window.scrollBy(0,-140);});await page.waitForTimeout(700);};
const snap=async()=>page.evaluate(()=>{const cs=[...document.querySelectorAll('div[data-pressable-container="true"]')];const own=c=>[...c.querySelectorAll('a[href^="/@"]')].find(a=>a.closest('[data-pressable-container]')===c&&/^\/@[^/]+\/?$/.test(a.getAttribute('href')))?.getAttribute('href');return {containers:cs.length,states:cs.map(c=>c.getAttribute('data-whospost')),chips:[...document.querySelectorAll('.whospost-chip:not(.whospost-chip-static)')].map(b=>`${b.className.replace(/whospost-chip /,'').replace('whospost-chip-','')}:${b.textContent}`),stubs:[...document.querySelectorAll('.whospost-stub')].map(s=>s.textContent.trim()),pill:document.querySelector('.whospost-pill')?.textContent??null,note:document.querySelector('.whospost-note')?.textContent??null,toast:document.querySelector('.whospost-toast')?.textContent??null,popover:document.querySelector('.whospost-pop')?.innerText??null,icons:document.querySelectorAll('.whospost-icon').length,authors:cs.map(own)};});
const phase1=await snap();console.log('PHASE1',JSON.stringify({...phase1,authors:undefined}));
await dismiss();await page.screenshot({path:`${OUT}/r0-list-api-off.png`});
const op=new URL(POST).pathname.match(/^\/@([^/]+)/)[1].toLowerCase();
const authors=[...new Set(phase1.authors.filter(Boolean).map(h=>h.replace(/^\/@/,'').replace(/\/$/,'').toLowerCase()))].filter(a=>a!==op);
console.log('non-OP authors',authors.slice(0,6));
const entries=[];
if(authors[0])entries.push({h:sha(authors[0]),score:4,hits:['content-comments','thread-focus','author-focus','burst-replies'],assessed:5,unknown:1,evidence:'rules',ai:null,scanId:'fixture-scan-1',updated:'2026-10-18T03:00:00Z',appeals:0});
if(authors[1])entries.push({h:sha(authors[1]),score:3,hits:['content-comments','thread-focus','author-focus'],assessed:4,unknown:2,evidence:'rules',ai:null,scanId:'fixture-scan-2',updated:'2026-10-20T03:00:00Z',appeals:1});
if(authors[2])entries.push({h:sha(authors[2]),score:1,hits:['content-comments'],assessed:4,unknown:2,evidence:'rules',ai:null,scanId:'fixture-scan-3',updated:'2026-10-18T03:00:00Z',appeals:0});
await popup.evaluate(async({entries})=>{await chrome.storage.local.set({list:{version:'signals-v2',accounts:entries,generated:new Date().toISOString(),etag:'"fixture"',fetchedAt:Date.now(),failedAt:null,failure:null}});},{entries});
// thread thresholds down to 2 through the popup UI (also exercises the popup → settings path)
await popup.reload();await popup.waitForTimeout(500);
await popup.fill('#threadBarAt','2');await popup.dispatchEvent('#threadBarAt','change');await popup.fill('#threadSameContentAt','2');await popup.dispatchEvent('#threadSameContentAt','change');
await page.waitForTimeout(2500);
const phase2=await snap();console.log('PHASE2',JSON.stringify({...phase2,authors:undefined}));
const stub=page.locator('.whospost-stub').first();
await dismiss();
if(await stub.count()){await top(stub);await dismiss();}
await page.screenshot({path:`${OUT}/r1-default-folded.png`});
// popup with this page's summary
await popup.reload();await popup.waitForTimeout(800);
console.log('pageStats',JSON.stringify(await popup.evaluate(()=>chrome.storage.local.get('pageStats').then(r=>r.pageStats))));
console.log('POPUP',(await popup.innerText('body')).replace(/\n+/g,' | ').slice(0,400));
await popup.screenshot({path:`${OUT}/r4-popup.png`,fullPage:true});
// "顯示" on the folded row → dimmed replies with chips + toast; wait the toast out, then open the popover from the orange chip
if(await stub.count()){
 await stub.locator('.whospost-stub-primary').dispatchEvent('click');await page.waitForTimeout(1200);
 const afterShow=await snap();console.log('AFTER SHOW',JSON.stringify({states:afterShow.states,chips:afterShow.chips,stubs:afterShow.stubs,pill:afterShow.pill,toast:afterShow.toast}));
 await page.waitForTimeout(5500);
 const chip=page.locator('.whospost-chip-orange:not(.whospost-chip-static)').first();
 await dismiss();await top(chip);await dismiss();
 await chip.dispatchEvent('click');await page.waitForTimeout(700);
 const withPop=await snap();console.log('POPOVER',JSON.stringify(withPop.popover));
 await page.screenshot({path:`${OUT}/r2-popover.png`});
 // trust from the popover → toast with undo, chip turns green
 await page.locator('.whospost-pop .whospost-btn-primary').dispatchEvent('click');await page.waitForTimeout(1200);
 const afterTrust=await snap();console.log('AFTER TRUST',JSON.stringify({states:afterTrust.states,chips:afterTrust.chips,stubs:afterTrust.stubs,pill:afterTrust.pill,toast:afterTrust.toast}));
 await dismiss();await page.locator('[data-whospost="trusted"]').first().evaluate(el=>el.scrollIntoView({block:'center'}));await page.waitForTimeout(600);await dismiss();await page.waitForTimeout(300);await page.screenshot({path:`${OUT}/r3-trusted-toast.png`});
 console.log('trusted store',JSON.stringify(await popup.evaluate(()=>chrome.storage.local.get('trusted').then(r=>r.trusted))));
 await page.locator('.whospost-toast-undo').dispatchEvent('click');await page.waitForTimeout(1200);
 const afterUndo=await snap();console.log('AFTER UNDO',JSON.stringify({states:afterUndo.states,chips:afterUndo.chips,toast:afterUndo.toast}));
 console.log('trusted store after undo',JSON.stringify(await popup.evaluate(()=>chrome.storage.local.get('trusted').then(r=>r.trusted))));
}
// "都信任" path on a fresh fold: reload so the run is folded again, then trust all
await page.reload({waitUntil:'domcontentloaded'});await page.waitForTimeout(6000);
const stub2=page.locator('.whospost-stub').first();
if(await stub2.count()){await stub2.locator('.whospost-stub-action').nth(1).dispatchEvent('click');await page.waitForTimeout(1200);const s=await snap();console.log('AFTER TRUST ALL',JSON.stringify({states:s.states,chips:s.chips,stubs:s.stubs,pill:s.pill,toast:s.toast}));await page.locator('.whospost-toast-undo').dispatchEvent('click');await page.waitForTimeout(1200);const u=await snap();console.log('AFTER UNDO ALL',JSON.stringify({stubs:u.stubs,pill:u.pill}));}
console.log('still on',page.url());
console.log('LOGS',JSON.stringify(logs,null,0).slice(0,1200));
fs.writeFileSync(`${OUT}/result2.json`,JSON.stringify({extId,phase1,phase2,logs},null,1));
await ctx.close();
