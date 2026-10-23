// End-to-end run of the extension (EXTENSION-SPEC §6.3): Playwright's Chromium loads extension/ (its new headless mode
// still allows --load-extension; Chrome stable 137+ does not) and drives a Threads post page.
//   --fixture (default; the CI gate): fixture/post.html is served under the real threads.com URL through request
//     routing, so the content script runs exactly as installed; the list is seeded into storage; every expectation is
//     asserted and the process exits 1 if any failed. Offline apart from the extension's own calls to the site.
//   --live [url]: the real logged-out page (default: a public @zuck post); screenshots for review; exits 1 only when
//     the engine reports the layout changed — the daily job answering 「版面壞了多久」 before users do — else 0 with warnings.
// --out <dir> (default ./e2e-out) collects screenshots and result.json. Needs Playwright with Chromium installed.
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {BODIES,FIXTURE_URL} from './capture-fixture-meta.mjs';
const {chromium}=await import('playwright');
const args=process.argv.slice(2);
const flag=name=>{const i=args.indexOf(name);return i>=0?(args[i+1]&&!args[i+1].startsWith('--')?args[i+1]:true):null;};
const LIVE=flag('--live'),OUT=path.resolve(typeof flag('--out')==='string'?flag('--out'):'./e2e-out');
const POST=typeof LIVE==='string'?LIVE:'https://www.threads.com/@zuck/post/DeZtp-TkQHh';
const EXT=path.resolve(import.meta.dirname,'../../../extension'),SITE='https://whospost.felixlai.workers.dev';
const sha=t=>createHash('sha256').update(t).digest('hex');
const today=()=>new Date(Date.now()+8*3600000).toISOString().slice(0,10);
fs.mkdirSync(OUT,{recursive:true});
const results=[];let failed=0;
/** Records one expectation. In fixture mode a miss fails the run; in live mode only `hard` ones do. */
const check=(name,ok,detail='',{hard=!LIVE}={})=>{results.push({name,ok:!!ok,detail:String(detail).slice(0,400)});const mark=ok?'✔':hard?'✖':'⚠';console.log(`${mark} ${name}${ok?'':` — ${String(detail).slice(0,300)}`}`);if(!ok&&hard)failed++;};
const ctx=await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(),'whospost-e2e-')),{channel:'chromium',headless:true,locale:'zh-TW',viewport:{width:1280,height:900},args:[`--disable-extensions-except=${EXT}`,`--load-extension=${EXT}`]});
const sw=ctx.serviceWorkers()[0]||await ctx.waitForEvent('serviceworker');
const extId=new URL(sw.url()).host;
console.log('extension',extId,LIVE?`live ${POST}`:'fixture');
let fixtureHtml=null;
if(!LIVE){
 fixtureHtml=fs.readFileSync(path.join(import.meta.dirname,'fixture','post.html'),'utf8');
 // The broken variant: profile links no longer start with /@, so no author is found while the permalinks remain.
 const brokenHtml=fixtureHtml.replace(/href="\/@/g,'href="/u/@');
 await ctx.route('**/*',route=>{
  const u=route.request().url();
  if(u.startsWith('chrome-extension://')||u.startsWith(SITE))return route.continue();
  if(u.split('?')[0]===FIXTURE_URL)return route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:fixtureHtml});
  if(u.split('?')[0]===FIXTURE_URL.replace('FIXTURE0001','FIXTURE0002'))return route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:brokenHtml});
  return route.abort();
 });
}
const logs=[];
const page=await ctx.newPage();
page.on('console',m=>{if(/whospost/i.test(m.text())||m.type()==='error')logs.push(`[${m.type()}] ${m.text().slice(0,300)}`);});
page.on('pageerror',e=>logs.push(`[pageerror] ${String(e).slice(0,300)}`));
const popup=await ctx.newPage();await popup.goto(`chrome-extension://${extId}/popup.html`);
const local=async key=>popup.evaluate(k=>chrome.storage.local.get(k).then(r=>r[k]),key);
for(let i=0;i<40;i++){const l=await local('list');if(l&&(l.failedAt||l.fetchedAt)){console.log('list fetch:',l.fetchedAt?`ok (${l.accounts?.length} accounts)`:`failed (${l.failure})`);break;}await popup.waitForTimeout(250);}
const url=LIVE?POST:FIXTURE_URL;
await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});
await page.waitForTimeout(LIVE?6000:2500);
if(LIVE)for(let i=0;i<2;i++){await page.mouse.wheel(0,900);await page.waitForTimeout(1200);}
// Live only: Threads keeps reopening its logged-out sign-in dialog; hide that subtree so screenshots show the page.
const dismiss=async()=>{if(!LIVE)return;await page.keyboard.press('Escape');await page.waitForTimeout(300);await page.evaluate(()=>{for(const d of document.querySelectorAll('[role=dialog]')){if(d.classList.contains('whospost-pop'))continue;let n=d;while(n.parentElement&&n.parentElement!==document.body&&!n.parentElement.querySelector('[data-pressable-container]'))n=n.parentElement;n.style.display='none';}});await page.waitForTimeout(200);};
const top=async loc=>{await loc.evaluate(el=>{el.scrollIntoView({block:'start'});window.scrollBy(0,-140);});await page.waitForTimeout(500);};
const snap=()=>page.evaluate(()=>{const cs=[...document.querySelectorAll('div[data-pressable-container="true"]')];const own=c=>[...c.querySelectorAll('a[href^="/@"]')].find(a=>a.closest('[data-pressable-container]')===c&&/^\/@[^/]+\/?$/.test(a.getAttribute('href')))?.getAttribute('href').replace(/^\/@/,'').replace(/\/$/,'').toLowerCase()??null;const chipOf=c=>[...c.querySelectorAll('.whospost-chip:not(.whospost-chip-static)')].map(b=>`${b.className.replace(/whospost-chip /,'').replace('whospost-chip-','')}:${b.textContent}`)[0]??null;return {rows:cs.map(c=>({author:own(c),state:c.getAttribute('data-whospost'),chip:chipOf(c),icon:!!c.querySelector('.whospost-icon')})),stubs:[...document.querySelectorAll('.whospost-stub')].map(s=>s.textContent.trim()),pill:document.querySelector('.whospost-pill')?.textContent??null,health:document.querySelector('.whospost-pill')?.getAttribute('data-whospost-health')??null,note:document.querySelector('.whospost-note')?.textContent??null,toast:document.querySelector('.whospost-toast')?.textContent??null,popover:document.querySelector('.whospost-pop')?.innerText??null};});
// Escape (in dismiss) would also close our popover, so the popover shot skips it.
const shot=async(name,{hide=true}={})=>{if(hide)await dismiss();await page.screenshot({path:path.join(OUT,`${name}.png`)});};
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
 check('the author\'s own replies and related threads are left alone',by(a,'opaccount').every(r=>!r.state&&!r.chip)&&a.rows.filter(r=>/^other/.test(r.author??'')).every(r=>!r.state&&!r.chip),JSON.stringify(a.rows.filter(r=>r.author==='opaccount'||/^other/.test(r.author??''))));
}
await shot(LIVE?'ui2-0-list-api-off':'f0-no-list');
// ---- Phase B: a list with three accounts seen on the page (4, 3 and 1 hits).
const op=new URL(url).pathname.match(/^\/@([^/]+)/)[1].toLowerCase();
const authors=LIVE?[...new Set(replies.map(r=>r.author))].filter(x=>x!==op).slice(0,3):['user01','user02','user03'];
const entries=[];
if(authors[0])entries.push({h:sha(authors[0]),score:4,hits:['content-comments','thread-focus','author-focus','burst-replies'],assessed:5,unknown:1,evidence:'rules',ai:null,scanId:'fixture-scan-1',updated:'2026-10-18T03:00:00Z',appeals:0});
if(authors[1])entries.push({h:sha(authors[1]),score:3,hits:['content-comments','thread-focus','author-focus'],assessed:4,unknown:2,evidence:'rules',ai:null,scanId:'fixture-scan-2',updated:'2026-10-20T03:00:00Z',appeals:1});
if(authors[2])entries.push({h:sha(authors[2]),score:1,hits:['content-comments'],assessed:4,unknown:2,evidence:'rules',ai:null,scanId:'fixture-scan-3',updated:'2026-10-18T03:00:00Z',appeals:0});
await popup.evaluate(async({entries})=>{await chrome.storage.local.set({list:{version:'signals-v2',accounts:entries,generated:new Date().toISOString(),etag:'"fixture"',fetchedAt:Date.now(),failedAt:null,failure:null}});},{entries});
if(LIVE){await popup.reload();await popup.waitForTimeout(500);await popup.fill('#threadBarAt','2');await popup.dispatchEvent('#threadBarAt','change');await popup.fill('#threadSameContentAt','2');await popup.dispatchEvent('#threadSameContentAt','change');}
await page.waitForTimeout(2500);
const b=await snap();
console.log('B',JSON.stringify({states:b.rows.map(r=>r.state),chips:b.rows.map(r=>r.chip).filter(Boolean),stubs:b.stubs,pill:b.pill}));
const g1=by(b,authors[0])[0],g2=by(b,authors[1])[0],g3=by(b,authors[2])[0];
check('two accounts at ≥3 hits are folded into one group',g1?.state==='group'&&g2?.state==='group',JSON.stringify([g1,g2]));
check('folded row: 「已收起 2 則」 with the two most common reasons, 顯示, 都信任',b.stubs.length===1&&/^已收起 2 則/.test(b.stubs[0])&&/留言大量重複/.test(b.stubs[0])&&/顯示/.test(b.stubs[0])&&/都信任/.test(b.stubs[0]),b.stubs.join(' | '));
check('one hit → grey chip 「6 項中 1 項符合」, not folded',g3?.chip==='grey:6 項中 1 項符合'&&g3?.state==='info',JSON.stringify(g3));
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
check('popup: 「已收起 2 則 · 查過 3 個帳號 · 本串觀察 N 個帳號」',new RegExp(`已收起 2 則 · 查過 3 個帳號 · 本串觀察 ${LIVE?'\\d+':'4'} 個帳號`).test(popupText),popupText.slice(0,200));
check('popup: reporting switch on, line shows today\'s counts',await popup.isChecked('#report')&&/今天累計：看了 \d+ 頁 · 比對 \d+ 個帳號/.test(await popup.innerText('#reportLine')),await popup.innerText('#reportLine'));
await popup.screenshot({path:path.join(OUT,LIVE?'ui2-4-popup.png':'f4-popup.png'),fullPage:true});
// ---- 顯示 → the run opens as dimmed replies with orange chips; the popover; trust; undo.
if(await stub.count()){
 await stub.locator('.whospost-stub-primary').dispatchEvent('click');await page.waitForTimeout(1200);
 const s=await snap();
 check('顯示: both replies dimmed with orange chips, toast 「已顯示 2 則 · 復原」',by(s,authors[0])[0]?.state==='fade'&&by(s,authors[0])[0]?.chip==='orange:6 項中 4 項符合'&&by(s,authors[1])[0]?.chip==='orange:6 項中 3 項符合'&&/已顯示 2 則/.test(s.toast??'')&&/復原/.test(s.toast??''),JSON.stringify({a:by(s,authors[0])[0],b:by(s,authors[1])[0],toast:s.toast,stubs:s.stubs}));
 check('顯示: pill gone (nothing folded)',s.pill===null,s.pill);
 await page.waitForTimeout(5500);
 const chip=page.locator('.whospost-chip-orange:not(.whospost-chip-static)').first();
 await dismiss();await top(chip);
 await chip.dispatchEvent('click');await page.waitForTimeout(700);
 const p=await snap();
 console.log('POPOVER',JSON.stringify(p.popover));
 check('popover: conclusion for the strongest hit, 4 reason chips, the count line, the disclaimer, two buttons',new RegExp(`@${authors[0]}`).test(p.popover??'')&&/留言像機器在發/.test(p.popover??'')&&/6 項檢查中 4 項符合、1 項不符合、1 項資料不足/.test(p.popover??'')&&/信任這個帳號/.test(p.popover??'')&&/看完整證據/.test(p.popover??''),p.popover);
 check('popover: no troll probability or verdict wording',!/%|網軍的機率|可能是網軍|判定為/.test(p.popover??''),p.popover);
 await shot(LIVE?'ui2-2-popover':'f2-popover',{hide:false});
 await page.locator('.whospost-pop .whospost-btn-primary').dispatchEvent('click');await page.waitForTimeout(1200);
 const t=await snap();
 check('信任: reply back to normal with the green 「已信任」 chip, toast with 復原',by(t,authors[0])[0]?.state==='trusted'&&by(t,authors[0])[0]?.chip==='green:已信任'&&new RegExp(`已信任 @${authors[0]}，之後不再收起`).test(t.toast??''),JSON.stringify({row:by(t,authors[0])[0],toast:t.toast}));
 const trusted=await local('trusted');
 check('信任: stored under the account hash with the username',trusted?.[sha(authors[0])]?.username===authors[0],JSON.stringify(trusted));
 await dismiss();await page.locator('[data-whospost="trusted"]').first().evaluate(el=>el.scrollIntoView({block:'center'}));await page.waitForTimeout(400);
 await shot(LIVE?'ui2-3-trusted-toast':'f3-trusted-toast');
 // Undo while the toast is still up (5 s): the trust press is withdrawn before the tally batch goes out, so it never counts.
 await page.locator('.whospost-toast-undo').dispatchEvent('click');await page.waitForTimeout(1200);
 const u=await snap();
 check('復原: trust withdrawn, chip orange again',!(await local('trusted'))?.[sha(authors[0])]&&by(u,authors[0])[0]?.state==='fade'&&by(u,authors[0])[0]?.chip==='orange:6 項中 4 項符合',JSON.stringify({row:by(u,authors[0])[0],trusted:await local('trusted')}));
}else check('folded row present for the 顯示 / popover / 信任 steps',false,'no .whospost-stub');
// ---- 都信任 on a fresh fold: once undone right away (does not count), once for keeps (counts two presses).
// The page's own counts go out about 5 s after a scan; waiting that out first makes the tally's trusted count exact.
await page.reload({waitUntil:'domcontentloaded'});await page.waitForTimeout(LIVE?6000:5500);
const stub2=page.locator('.whospost-stub').first();
if(await stub2.count()){
 await stub2.locator('.whospost-stub-action').nth(1).dispatchEvent('click');await page.waitForTimeout(1200);
 const s=await snap();
 check('都信任: both accounts trusted, toast 「已信任 2 個帳號，之後不再收起 · 復原」',by(s,authors[0])[0]?.state==='trusted'&&by(s,authors[1])[0]?.state==='trusted'&&/已信任 2 個帳號，之後不再收起/.test(s.toast??'')&&s.stubs.length===0,JSON.stringify({toast:s.toast,stubs:s.stubs}));
 await page.locator('.whospost-toast-undo').dispatchEvent('click');await page.waitForTimeout(1200);
 const u=await snap();
 check('都信任 → 復原: the folded row is back',u.stubs.length===1&&/^已收起 2 則/.test(u.stubs[0])&&Object.keys((await local('trusted'))??{}).length===0,JSON.stringify({stubs:u.stubs,trusted:await local('trusted')}));
 await page.waitForTimeout(4500);
 await page.locator('.whospost-stub').first().locator('.whospost-stub-action').nth(1).dispatchEvent('click');await page.waitForTimeout(1200);
 check('都信任 again, kept: two accounts in the trust list',Object.keys((await local('trusted'))??{}).length===2,JSON.stringify(await local('trusted')));
}else check('folded row present again after reload for 都信任',false,'no .whospost-stub');
check('still on the post page: our widgets never navigated',page.url().split('?')[0]===url.split('?')[0],page.url());
// ---- 回報貢獻: only the kept presses count; the switch off clears the record.
const after=await waitFor(async()=>{const r=await local('report');return r?.tally?.trusted>=2?r:null;},12000);
check('回報貢獻: two trust presses counted (the kept 都信任); the undone ones never were',after?.tally?.trusted===2&&after.tally.pages>=2,JSON.stringify(after?.tally));
await popup.reload();await popup.waitForTimeout(500);
await popup.uncheck('#report');await popup.waitForTimeout(600);
check('回報貢獻 off: the local record is cleared and the popup says so',(await local('report'))===undefined&&/已關閉/.test(await popup.innerText('#reportLine')),JSON.stringify(await local('report')));
await popup.check('#report');await popup.waitForTimeout(400);
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
await ctx.close();
console.log(failed?`\n${failed} check(s) failed`:'\nall checks passed');
process.exit(failed?1:0);
