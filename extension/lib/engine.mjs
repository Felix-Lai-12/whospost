// The content-script engine (§6.2, after KillSlop's feed.js): one MutationObserver and a passive scroll listener
// both call scheduleScan(); scheduleScan folds bursts into one requestIdleCallback; scan() reads each reply
// container by structure, runs the thread rules, matches the list in memory, and only touches the DOM of a
// container whose render key changed. Everything decided here is pure code from the sibling modules.
import {CONTAINER_SELECTOR,AUTHOR_SELECTOR,PERMALINK_SELECTOR,parseContainer,pageContext,healthVerdict,usernameFromHref,threadRootOf} from './parse.mjs';
import {createThread,threadVerdict} from './thread.mjs';
import {indexList,listStatus} from './list.mjs';
import {decide,renderKey} from './state.mjs';
import {mergeSettings,effectiveMode} from './settings.mjs';
import {createHashCache} from './hash.mjs';
import {barText,whyCard,counterText,checkUrl,SITE} from './label.mjs';
const BAND_ABOVE=800,BAND_BELOW=1600,BROKEN_SCANS=3,STATS_THROTTLE=500;
const ATTR='data-whospost',ATTR_H='data-whospost-h',ATTR_KEY='data-whospost-key';
const ICON_SVG='<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10.5 10.5 14 14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
const idle=cb=>(globalThis.requestIdleCallback??(f=>setTimeout(()=>f({timeRemaining:()=>50}),50)))(cb,{timeout:500});
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;};
const link=(label,href)=>{const a=el('a','whospost-link',label);a.href=href;a.target='_blank';a.rel='noopener noreferrer';return a;};
// Threads opens the post on almost any pointer event inside a container, so our own widgets swallow them; a real link
// inside the bar still navigates (only propagation is stopped), everything else is prevented too.
const swallow=node=>{for(const type of ['click','mousedown','mouseup','pointerdown','pointerup','touchstart','touchend','keydown'])node.addEventListener(type,e=>{e.stopPropagation();if(type==='click'&&!e.target.closest('a[href]'))e.preventDefault();});};
export function createEngine({storage,runtime,doc=document,win=window}){
 const hashes=createHashCache();
 const thread=createThread();
 const nodeIds=new WeakMap();let nextNodeId=1;
 const nodeId=n=>{let id=nodeIds.get(n);if(!id){id=`n${nextNodeId++}`;nodeIds.set(n,id);}return id;};
 let settings=mergeSettings(null),trusted={},list=indexList([]),listState='missing',listGenerated=null;
 let page={kind:'other'},lastPath=null,shown=new Set(),health='ok',brokenRuns=0,epoch=0;
 let stats={checked:0,listed:0,flagged:0,thread:0},statsTimer=null,pill=null,queued=false,observer=null;
 const byAuthor=new Map(); // username → {h, entry, listed, flagged, threadHit}
 function setList(cache){list=indexList(cache?.accounts);listState=listStatus(cache);listGenerated=cache?.generated??null;}
 function setSettings(saved){settings=mergeSettings(saved);epoch++;}
 function setTrusted(saved){trusted=saved&&typeof saved==='object'?saved:{};epoch++;}
 function resetPage(){
  thread.reset();shown=new Set();byAuthor.clear();stats={checked:0,listed:0,flagged:0,thread:0};brokenRuns=0;
  for(const n of doc.querySelectorAll(`[${ATTR}]`))clear(n);
  for(const n of doc.querySelectorAll('.whospost-icon,.whospost-bar'))n.remove();
 }
 function clear(n){n.removeAttribute(ATTR);n.removeAttribute(ATTR_H);n.removeAttribute(ATTR_KEY);for(const c of n.querySelectorAll(':scope > .whospost-bar'))c.remove();}
 function inBand(n){const r=n.getBoundingClientRect();return r.bottom>=-BAND_ABOVE&&r.top<=win.innerHeight+BAND_BELOW;}
 function theme(){try{const bg=getComputedStyle(doc.body).backgroundColor.match(/\d+(\.\d+)?/g)?.map(Number)??[255,255,255];const lum=(0.2126*bg[0]+0.7152*bg[1]+0.0722*bg[2])/255;doc.documentElement.setAttribute('data-whospost-theme',lum<0.5?'dark':'light');}catch{}}
 async function scan(){
  queued=false;
  const path=win.location.pathname;
  if(path!==lastPath){lastPath=path;page=pageContext(path);resetPage();}
  theme();
  if(!settings.enabled||page.kind!=='post'){if(!settings.enabled)resetPage();drawPill();return;}
  const all=[...doc.querySelectorAll(CONTAINER_SELECTOR)].map(node=>({node,info:parseContainer(node)}));
  // Only this thread: the main post's replies, not the related threads further down (same containers, other column).
  const main=all.find(({info})=>info&&info.username===page.author&&info.shortcode===page.shortcode);
  const root=main?threadRootOf(main.node):null;
  const parsed=[];
  for(const {node,info} of all){
   if(!info)continue;
   if(root&&!root.contains(node)){if(node.hasAttribute(ATTR))clear(node);node.querySelector(':scope .whospost-icon')?.remove();continue;}
   parsed.push({node,info});
   if(info.username===page.author){if(node.hasAttribute(ATTR))clear(node);continue;}
   thread.add({username:info.username,replyKey:info.shortcode??nodeId(node),text:info.text});
  }
  const verdict=healthVerdict({permalinks:doc.querySelectorAll(PERMALINK_SELECTOR).length,parsed:all.filter(x=>x.info).length});
  brokenRuns=verdict==='broken'?brokenRuns+1:0;
  const nextHealth=brokenRuns>=BROKEN_SCANS?'broken':'ok';
  if(nextHealth!==health){health=nextHealth;if(health==='broken')resetPage();}
  if(health==='broken'){drawPill();return;}
  const mode=effectiveMode(settings);
  await Promise.all(parsed.map(async({node,info})=>{
   if(info.username===page.author)return;
   const h=await hashes.hash(info.username);
   if(!node.isConnected)return;
   // A node React recycled for another account must not keep the old account's mark.
   if(node.getAttribute(ATTR_H)&&node.getAttribute(ATTR_H)!==h)clear(node);
   const entry=list.get(h)??null;
   const tv=threadVerdict(thread.observe(info.username),settings.thread);
   const decision=decide({trusted:!!trusted[h],shown:shown.has(h),entry,thread:tv,listStatus:listState,settings,mode});
   byAuthor.set(info.username,{h,entry,listed:decision.listed,flagged:decision.flagged,threadHit:decision.threadHit});
   if(!inBand(node)&&!node.hasAttribute(ATTR))return;
   render(node,{h,username:info.username,entry,tv,decision});
  }));
  let checked=0,listed=0,flagged=0,threadHits=0;
  for(const a of byAuthor.values()){checked++;if(a.listed)listed++;if(a.flagged)flagged++;if(a.threadHit)threadHits++;}
  stats={checked,listed,flagged,thread:threadHits};
  drawPill();
 }
 function render(node,{h,username,entry,tv,decision}){
  const key=renderKey(h,decision,`${listState}|${epoch}|${settings.showIcon?1:0}`);
  if(node.getAttribute(ATTR_KEY)===key)return;
  for(const c of node.querySelectorAll(':scope > .whospost-bar'))c.remove();
  node.setAttribute(ATTR_H,h);node.setAttribute(ATTR,decision.state);node.setAttribute(ATTR_KEY,key);
  if(['info','fade','collapse'].includes(decision.state))node.prepend(bar({h,username,entry,tv,decision}));
  placeIcon(node,username);
 }
 function placeIcon(node,username){
  const existing=node.querySelector(':scope .whospost-icon');
  if(!settings.showIcon){existing?.remove();return;}
  if(existing)return;
  // The name link, not the avatar link (both point at /@name; the avatar one has no text), so the icon sits beside the name.
  const links=[...node.querySelectorAll(AUTHOR_SELECTOR)].filter(a=>a.closest('[data-pressable-container]')===node&&usernameFromHref(a.getAttribute('href'))===username);
  const author=links.find(a=>a.textContent.trim())??links[0];
  if(!author)return;
  // Inside the name link, right after the name text (a sibling would wrap onto its own line): a span, not a nested
  // anchor, that opens the site itself and keeps the click away from the profile link and the post.
  const icon=el('span','whospost-icon');icon.title='用 Whospost 查這個帳號';icon.setAttribute('role','link');icon.setAttribute('tabindex','0');icon.setAttribute('aria-label','用 Whospost 查這個帳號');icon.innerHTML=ICON_SVG;
  const open=()=>win.open(checkUrl(username),'_blank','noopener,noreferrer');
  icon.addEventListener('click',open);icon.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' ')open();});
  // The innermost text span of the name link, so the icon flows with the name instead of wrapping below it.
  const nameSpan=[...author.querySelectorAll('span')].reverse().find(sp=>sp.textContent.trim()&&!sp.querySelector('span'));
  swallow(icon);(nameSpan??author).append(icon);
 }
 function bar({h,username,entry,tv,decision}){
  const text=barText({entry,thread:decision.threadHit?tv:null,listStatus:listState,generated:listGenerated,fadeAt:settings.fadeAt});
  const wrap=el('div',`whospost-bar whospost-${text.tone}`);wrap.setAttribute('data-whospost-state',decision.state);
  const head=el('div','whospost-bar-head');
  const label=el('button','whospost-bar-text',text.text);label.type='button';label.title='點一下看為什麼';
  const actions=el('span','whospost-actions');
  if(decision.state==='fade'||decision.state==='collapse'){const show=el('button','whospost-btn','顯示');show.type='button';show.title='這一則恢復原樣';show.addEventListener('click',()=>{shown.add(h);scheduleScan();});actions.append(show);}
  const trust=el('button','whospost-btn','信任');trust.type='button';trust.title='這個帳號以後都不標（存在這台電腦，並匿名回報一次）';
  trust.addEventListener('click',async()=>{trusted={...trusted,[h]:{username,at:Date.now()}};await storage.setTrusted(trusted);epoch++;scheduleScan();runtime.appeal(h).catch(()=>{});});
  actions.append(trust);head.append(label,actions);wrap.append(head);
  const card=el('div','whospost-card');card.hidden=true;
  label.addEventListener('click',()=>{if(card.hidden&&!card.childElementCount)fillCard(card,whyCard({username,entry,thread:tv}));card.hidden=!card.hidden;});
  wrap.append(card);swallow(wrap);
  return wrap;
 }
 function fillCard(card,model){
  card.append(el('p','whospost-card-title',model.title));
  const ul=el('ul','whospost-card-list');
  for(const line of model.lines){const li=el('li',`whospost-line whospost-line-${line.status}`,line.label);ul.append(li);}
  card.append(ul,el('p','whospost-card-note',model.note));
  const links=el('p','whospost-card-links');for(const l of model.links)links.append(link(l.label,l.href));card.append(links);
 }
 function drawPill(){
  if(page.kind!=='post'){pill?.remove();pill=null;return;}
  if(!pill){pill=el('button','whospost-pill');pill.type='button';pill.title='Whospost：這一頁的比對結果';pill.addEventListener('click',()=>runtime.openPopup());doc.documentElement.append(pill);}
  pill.textContent=counterText(stats,{listStatus:listState,health,enabled:settings.enabled});
  pill.setAttribute('data-whospost-health',health);
  // Throttled, not debounced: Threads mutates its DOM constantly (video players, timers), so a debounce would never fire.
  if(!statsTimer)statsTimer=setTimeout(()=>{statsTimer=null;storage.setPageStats({...stats,health,listStatus:listState,page:page.kind,at:Date.now()}).catch(()=>{});},STATS_THROTTLE);
 }
 function scheduleScan(){if(queued)return;queued=true;idle(()=>{scan().catch(e=>{queued=false;console.warn('[whospost] scan failed',e);});});}
 return {
  async start(){
   const [saved,trustedSaved,listSaved]=await Promise.all([storage.getSettings(),storage.getTrusted(),storage.getList()]);
   setSettings(saved);setTrusted(trustedSaved);setList(listSaved);
   storage.onChange(({settings:s,trusted:t,list:l})=>{let changed=false;if(s!==undefined){setSettings(s);changed=true;}if(t!==undefined){setTrusted(t);changed=true;}if(l!==undefined){setList(l);epoch++;changed=true;}if(changed)scheduleScan();});
   observer=new MutationObserver(scheduleScan);observer.observe(doc.documentElement,{childList:true,subtree:true});
   win.addEventListener('scroll',scheduleScan,{passive:true});
   scheduleScan();
   runtime.ensureList().then(l=>{if(l){setList(l);scheduleScan();}}).catch(()=>{});
  },
  scheduleScan,
  get state(){return {health,listState,stats,page,settings};}
 };
}
export {SITE};
