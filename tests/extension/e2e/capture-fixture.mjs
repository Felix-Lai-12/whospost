// Captures the e2e fixture: a real logged-out Threads post page, as rendered, turned into one static HTML file the
// engine can be run against offline (EXTENSION-SPEC §6.3: "用存下來的 Threads HTML fixture"). What is kept is the DOM
// structure Threads renders; what is changed: every account name is replaced by a fixture name (user01…, opaccount,
// other01… for the related threads below), every shortcode by a fixture code, every reply body by fixture text that
// sets up the scenario run.mjs asserts on, images by a data URI, scripts dropped, and the stylesheets reduced to the
// rules the page actually uses. Rerun when Threads changes its markup: node tests/extension/e2e/capture-fixture.mjs [post url]
import fs from 'node:fs';
import path from 'node:path';
const {chromium}=await import('playwright');
const POST=process.argv[2]||'https://www.threads.com/@zuck/post/DeZtp-TkQHh';
const OUT=path.join(import.meta.dirname,'fixture','post.html');
import {BODIES} from './capture-fixture-meta.mjs';
// The scenario (indexes are reply positions in thread order, after the main post; bodies in capture-fixture-meta.mjs):
//  0,1  user01,user02  on the seeded list with 4 and 3 hits → folded together
//  2    user03         on the list with 1 hit → grey chip
//  3-5  user04-06      the same text from three accounts → blue chip (same content ≥3)
//  6    user07         five replies (the container is cloned four times) → blue chip「本串 5 則」
//  rest userNN         unknown accounts → hover icon only
const FILLER=['路過看看','資訊有誤吧？','這件事我不太清楚','樓上講得有道理','先觀望一下','有來源嗎','笑死','同意','不同意，理由很多','晚點再看'];
const CLONES=4;
const op=new URL(POST).pathname.match(/^\/@([^/]+)/)[1].toLowerCase(),mainCode=new URL(POST).pathname.match(/\/post\/([^/?#]+)/)[1];
const ctx=await chromium.launchPersistentContext(fs.mkdtempSync('/tmp/whospost-capture-'),{channel:'chromium',headless:true,locale:'zh-TW',viewport:{width:1280,height:900}});
const page=await ctx.newPage();
await page.goto(POST,{waitUntil:'domcontentloaded',timeout:60000});
await page.waitForTimeout(6000);
for(let i=0;i<2;i++){await page.mouse.wheel(0,900);await page.waitForTimeout(1200);}
await page.keyboard.press('Escape');await page.waitForTimeout(300);
// Stylesheets: fetched from Node (no CORS), then reduced in the page to the rules that match something.
const hrefs=await page.evaluate(()=>[...document.querySelectorAll('link[rel="stylesheet"]')].map(l=>l.href));
let css='';for(const h of hrefs){try{css+=await (await page.request.get(h)).text()+'\n';}catch(e){console.warn('stylesheet failed',h,e.message);}}
const info=await page.evaluate(({op,mainCode,css,BODIES,FILLER,CLONES})=>{
 const CONTAINER='div[data-pressable-container="true"]';
 const own=(c,a)=>a.closest('[data-pressable-container]')===c;
 const handleOf=href=>{const m=String(href||'').match(/^(?:https?:\/\/(?:www\.)?threads\.(?:com|net))?\/@([A-Za-z0-9_.]+)\/?(?:[?#].*)?$/);return m?m[1].toLowerCase():null;};
 const authorOf=c=>{for(const a of c.querySelectorAll('a[href^="/@"]')){if(!own(c,a))continue;const h=handleOf(a.getAttribute('href'));if(h)return h;}return null;};
 const codeOf=c=>{for(const a of c.querySelectorAll('a[href*="/post/"]')){if(!own(c,a))continue;const m=a.getAttribute('href').match(/\/post\/([A-Za-z0-9_-]+)/);if(m)return m[1];}return null;};
 const originalHandles=new Set([...document.querySelectorAll('a[href]')].map(a=>handleOf(a.getAttribute('href'))||String(a.getAttribute('href')).match(/\/@([A-Za-z0-9_.]+)\/post\//)?.[1]?.toLowerCase()).filter(Boolean));
 const displayName=document.querySelector('meta[property="og:title"]')?.content?.match(/^(.*?)\s*[（(]@/)?.[1]?.trim()||null;
 // The login dialog and everything that runs or loads.
 for(const d of document.querySelectorAll('[role=dialog]')){let n=d;while(n.parentElement&&n.parentElement!==document.body&&!n.parentElement.querySelector('[data-pressable-container]'))n=n.parentElement;n.remove();}
 for(const s of document.querySelectorAll('script,noscript,iframe,video,audio,source,picture>source,link:not([rel="stylesheet"]),meta:not([charset]):not([name="viewport"]),base,template'))s.remove();
 document.title='Threads fixture';
 // Thread scoping as the engine does it: the main post, then its lowest ancestor holding another container.
 const cs=[...document.querySelectorAll(CONTAINER)];
 const main=cs.find(c=>authorOf(c)===op&&codeOf(c)===mainCode);
 if(!main)throw new Error('main post not found');
 let root=main.parentElement;while(root&&root!==document.body&&root.querySelectorAll(CONTAINER).length<2)root=root.parentElement;
 const thread=cs.filter(c=>c!==main&&root.contains(c)&&authorOf(c)&&authorOf(c)!==op);
 const related=cs.filter(c=>!root.contains(c));
 const opOwn=cs.filter(c=>c!==main&&root.contains(c)&&authorOf(c)===op);
 // Reply bodies: the top-level span[dir=auto] blocks that are not the time, a number or a link.
 const bodySpans=c=>[...c.querySelectorAll('span[dir="auto"]')].filter(s=>own(c,s)&&!s.querySelector('time')&&!s.closest('a')&&!s.parentElement.closest('span[dir="auto"]')&&/[\p{L}\p{N}]/u.test(s.textContent)&&!/^[\d.,]+\s*[KkMm萬]?$/.test(s.textContent.trim()));
 const setBody=(c,text)=>{const spans=bodySpans(c);if(!spans.length)return false;spans[0].textContent=text;for(const s of spans.slice(1))s.remove();return true;};
 // Re-author one container: its profile links, name text, permalink and avatar alt.
 const reauthor=(c,handle,code)=>{
  const old=authorOf(c);
  for(const a of c.querySelectorAll('a[href]')){
   if(!own(c,a))continue;
   const href=a.getAttribute('href');
   if(handleOf(href)===old)a.setAttribute('href',`/@${handle}`);
   else if(/\/post\//.test(href)&&(href.includes(`/@${old}/`)||href.startsWith('/@')))a.setAttribute('href',`/@${handle}/post/${code}`);
  }
  const walker=document.createTreeWalker(c,NodeFilter.SHOW_TEXT);let t;
  while((t=walker.nextNode())){if(t.parentElement.closest('[data-pressable-container]')!==c)continue;if(t.nodeValue.trim().toLowerCase()===old)t.nodeValue=handle;}
 };
 const pad=n=>String(n).padStart(2,'0');
 const summary={op:'opaccount',thread:[],related:related.length,opOwn:opOwn.length,displayName:!!displayName};
 reauthor(main,'opaccount','FIXTURE0001');setBody(main,'這是測試用的貼文內容。');
 for(const c of opOwn){reauthor(c,'opaccount',`FXOP${pad(opOwn.indexOf(c)+1)}`);setBody(c,'作者的回覆。');}
 thread.forEach((c,i)=>{
  const handle=`user${pad(i+1)}`,text=BODIES[i]??FILLER[(i-BODIES.length)%FILLER.length];
  reauthor(c,handle,`FX${pad(i+1)}`);setBody(c,text);
  summary.thread.push({handle,text});
  if(i===6){for(let k=1;k<=CLONES;k++){const clone=c.cloneNode(true);reauthor(clone,handle,`FX${pad(i+1)}C${k}`);setBody(clone,`第 ${k+1} 次提醒：這才是重點`);c.parentElement.insertBefore(clone,c.nextSibling);summary.thread.push({handle,text:`第 ${k+1} 次提醒：這才是重點`,clone:true});}}
 });
 related.forEach((c,i)=>{reauthor(c,`other${pad(i+1)}`,`RX${pad(i+1)}`);setBody(c,`其他串的貼文 ${i+1}`);});
 // Anything else that still points at or names a real account.
 const extra=new Map();const mapped=h=>{if(!extra.has(h))extra.set(h,`anon${pad(extra.size+1)}`);return extra.get(h);};
 for(const a of document.querySelectorAll('a[href]')){const href=a.getAttribute('href');const h=handleOf(href);if(h&&!/^(user|other|anon)\d\d$|^opaccount$/.test(h))a.setAttribute('href',`/@${mapped(h)}`);else if(/^https?:/.test(href)&&/threads\.(com|net)/.test(href))a.setAttribute('href',new URL(href).pathname);}
 for(const img of document.querySelectorAll('img')){img.setAttribute('src','data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 40 40%22%3E%3Ccircle cx=%2220%22 cy=%2220%22 r=%2220%22 fill=%22%23cfd4da%22/%3E%3C/svg%3E');img.removeAttribute('srcset');img.removeAttribute('sizes');img.setAttribute('alt','');}
 for(const n of document.querySelectorAll('[style*="url("]'))n.setAttribute('style',n.getAttribute('style').replace(/url\([^)]*\)/g,'none'));
 // Used CSS only.
 const style=document.createElement('style');style.textContent=css;document.head.append(style);
 const strip=s=>s.replace(/::?-?[a-z-]+(\([^)]*\))?/g,m=>/^:(not|is|where|has|nth-|first-|last-|only-|empty|root|dir|lang)/.test(m)?m:'').trim()||'*';
 const keep=[];
 const walk=(rules,out)=>{for(const r of rules){
  if(r instanceof CSSStyleRule){const sels=r.selectorText.split(/,(?![^(]*\))/).map(s=>s.trim()).filter(s=>{try{return !!document.querySelector(strip(s));}catch{return false;}});if(sels.length)out.push(`${sels.join(',')}{${r.style.cssText}}`);}
  else if(r instanceof CSSMediaRule){const inner=[];walk(r.cssRules,inner);if(inner.length)out.push(`@media ${r.conditionText}{${inner.join('\n')}}`);}
  else if(r instanceof CSSSupportsRule){const inner=[];walk(r.cssRules,inner);if(inner.length)out.push(`@supports ${r.conditionText}{${inner.join('\n')}}`);}
  else if(r instanceof CSSKeyframesRule)out.push(r.cssText);
 }};
 walk(style.sheet.cssRules,keep);style.remove();
 for(const l of document.querySelectorAll('link[rel="stylesheet"]'))l.remove();
 const used=document.createElement('style');used.setAttribute('data-fixture','used-css');used.textContent=keep.join('\n').replace(/url\((['"]?)https?:[^)]*\1\)/g,'none');document.head.append(used);
 const note=document.createElement('meta');note.name='whospost-fixture';note.content='captured from a public Threads post page; names, codes, bodies and images replaced';document.head.prepend(note);
 summary.originalHandles=[...originalHandles,...(displayName?[displayName]:[])];summary.cssRules=keep.length;summary.containers=document.querySelectorAll(CONTAINER).length;
 return {html:'<!doctype html>\n'+document.documentElement.outerHTML,summary};
},{op,mainCode,css,BODIES,FILLER,CLONES});
await ctx.close();
let html=info.html;
// Belt and braces: no original handle or display name may survive anywhere (attributes, titles, aria labels).
for(const h of info.summary.originalHandles){const re=new RegExp(h.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'gi');html=html.replace(re,'anon');}
for(const h of info.summary.originalHandles)if(html.toLowerCase().includes(h.toLowerCase()))throw new Error(`handle survived: ${h}`);
for(const host of ['cdninstagram','fbcdn','threads.com/','threads.net/'])if(html.includes(host))console.warn('fixture still references',host,(html.match(new RegExp(host,'g'))||[]).length,'times');
fs.writeFileSync(OUT,html);
console.log(JSON.stringify({...info.summary,originalHandles:info.summary.originalHandles.length,bytes:html.length,out:OUT},null,1));
