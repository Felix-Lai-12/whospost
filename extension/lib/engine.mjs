// The content-script engine (EXTENSION-SPEC §6.2, after KillSlop's feed.js; drawing per EXTENSION-UI-REDESIGN-20261023):
// one MutationObserver and a passive scroll listener both call scheduleScan(); scheduleScan folds bursts into one
// requestIdleCallback; scan() reads each reply container by structure, runs the thread rules, matches the list in
// memory, folds runs of suspicious replies into one "已收起 N 則" row, and only touches the DOM of a container whose
// render key changed. Everything decided here is pure code from the sibling modules.
import {CONTAINER_SELECTOR,AUTHOR_SELECTOR,PERMALINK_SELECTOR,parseContainer,pageContext,healthVerdict,usernameFromHref,threadRootOf} from './parse.mjs';
import {createThread,threadVerdict,firstReplies,NO_THREAD} from './thread.mjs';
import {indexList,listStatus} from './list.mjs';
import {decide,groupRuns,renderKey} from './state.mjs';
import {mergeSettings,effectiveMode} from './settings.mjs';
import {createHashCache} from './hash.mjs';
import {chipText,popoverModel,stubText,pillText,toastText,checkUrl,LIST_UNREADABLE,LAYOUT_CHANGED,SITE} from './label.mjs';
import {pageDelta,mergeDelta} from './report.mjs';
const BROKEN_SCANS=3,STATS_THROTTLE=500,TOAST_MS=5000,TALLY_DELAY=5000;
const ATTR='data-whospost',ATTR_H='data-whospost-h',ATTR_KEY='data-whospost-key',ATTR_STUB='data-whospost-stub';
const ICON_SVG='<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10.5 10.5 14 14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
const idle=cb=>(globalThis.requestIdleCallback??(f=>setTimeout(()=>f({timeRemaining:()=>50}),50)))(cb,{timeout:500});
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;};
const button=(cls,text,onClick)=>{const b=el('button',cls,text);b.type='button';b.addEventListener('click',onClick);return b;};
const link=(cls,label,href)=>{const a=el('a',cls,label);a.href=href;a.target='_blank';a.rel='noopener noreferrer';return a;};
// Threads opens the post on almost any pointer event inside a container, so our own widgets swallow them; a real link
// inside still navigates (only propagation is stopped), everything else is prevented too.
const swallow=node=>{for(const type of ['click','mousedown','mouseup','pointerdown','pointerup','touchstart','touchend','keydown'])node.addEventListener(type,e=>{e.stopPropagation();if(type==='click'&&!e.target.closest('a[href]'))e.preventDefault();});};
export function createEngine({storage,runtime,doc=document,win=window}){
 const hashes=createHashCache();
 const thread=createThread();
 const nodeIds=new WeakMap();let nextNodeId=1;
 const nodeId=n=>{let id=nodeIds.get(n);if(!id){id=`n${nextNodeId++}`;nodeIds.set(n,id);}return id;};
 let settings=mergeSettings(null),trusted={},list=indexList([]),listState='missing',listGenerated=null;
 let page={kind:'other'},lastPath=null,shown=new Set(),health='ok',brokenRuns=0,epoch=0;
 let stats={collapsed:0,checked:0,listed:0,flagged:0,thread:0},statsTimer=null,queued=false,observer=null;
 let pill=null,note=null,popover=null,toast=null,toastTimer=null,undo=null;
 const byAuthor=new Map(); // username → {h, entry, listed, flagged, threadHit}
 let collapsedHashes=new Set();
 // 「回報貢獻」(lib/report.mjs): what this page has already contributed to today's tally, and the batch not yet handed over.
 let committed={},pendingDelta=null,tallyTimer=null;
 function queueTally(delta){if(!delta||!settings.report)return;pendingDelta=mergeDelta(pendingDelta,delta);if(!tallyTimer)tallyTimer=setTimeout(flushTally,TALLY_DELAY);}
 function flushTally(){clearTimeout(tallyTimer);tallyTimer=null;if(!pendingDelta)return;const delta=pendingDelta;pendingDelta=null;Promise.resolve(runtime.tally?.(delta)).catch(()=>{});}
 function setList(cache){list=indexList(cache?.accounts);listState=listStatus(cache);listGenerated=cache?.generated??null;}
 function setSettings(saved){settings=mergeSettings(saved);epoch++;}
 function setTrusted(saved){trusted=saved&&typeof saved==='object'?saved:{};epoch++;}
 function resetPage(){
  flushTally();committed={};
  thread.reset();shown=new Set();byAuthor.clear();collapsedHashes=new Set();stats={collapsed:0,checked:0,listed:0,flagged:0,thread:0};
  for(const n of doc.querySelectorAll(`[${ATTR}]`))clear(n);
  for(const n of doc.querySelectorAll('.whospost-icon,.whospost-chip,.whospost-stub'))n.remove();
  closePopover();
 }
 function clear(n){n.removeAttribute(ATTR);n.removeAttribute(ATTR_H);n.removeAttribute(ATTR_KEY);n.removeAttribute(ATTR_STUB);for(const c of n.querySelectorAll(':scope > .whospost-stub, :scope .whospost-chip'))c.remove();}
 function theme(){try{const bg=getComputedStyle(doc.body).backgroundColor.match(/\d+(\.\d+)?/g)?.map(Number)??[255,255,255];const lum=(0.2126*bg[0]+0.7152*bg[1]+0.0722*bg[2])/255;doc.documentElement.setAttribute('data-whospost-theme',lum<0.5?'dark':'light');}catch{}}
 async function scan(){
  queued=false;
  const path=win.location.pathname;
  if(path!==lastPath){lastPath=path;page=pageContext(path);resetPage();brokenRuns=0;health='ok';}
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
   if(info.username===page.author){if(node.hasAttribute(ATTR))clear(node);continue;}
   parsed.push({node,info});
   thread.add({username:info.username,replyKey:info.shortcode??nodeId(node),text:info.text});
  }
  const verdict=healthVerdict({permalinks:doc.querySelectorAll(PERMALINK_SELECTOR).length,parsed:all.filter(x=>x.info).length});
  brokenRuns=verdict==='broken'?brokenRuns+1:0;
  const nextHealth=brokenRuns>=BROKEN_SCANS?'broken':'ok';
  if(nextHealth!==health){health=nextHealth;if(health==='broken'){resetPage();if(settings.report)Promise.resolve(runtime.domBroken?.()).catch(()=>{});}}
  if(health==='broken'){drawPill();return;}
  const mode=effectiveMode(settings);
  // The thread rules count every reply of an account, but only its first reply on the page carries their mark.
  const first=firstReplies(parsed.map(p=>p.info));
  const items=await Promise.all(parsed.map(async({node,info},i)=>{
   const h=await hashes.hash(info.username);
   const entry=list.get(h)??null;
   const tv=first[i]?threadVerdict(thread.observe(info.username),settings.thread):NO_THREAD;
   const decision=decide({trusted:!!trusted[h],shown:shown.has(h),entry,thread:tv,listStatus:listState,settings,mode});
   if(first[i])byAuthor.set(info.username,{h,entry,listed:decision.listed,flagged:decision.flagged,threadHit:decision.threadHit});
   return {node,username:info.username,h,entry,thread:decision.threadHit?tv:null,decision,collapse:decision.state==='collapse'};
  }));
  const live=items.filter(it=>it.node.isConnected);
  const groups=groupRuns(live);
  const groupOf=new Map();groups.forEach((g,i)=>g.members.forEach((m,j)=>groupOf.set(m,{index:i,first:j===0,group:g})));
  collapsedHashes=new Set(live.filter(it=>it.collapse).map(it=>it.h));
  for(const it of live){
   // A node React recycled for another account must not keep the old account's mark.
   if(it.node.getAttribute(ATTR_H)&&it.node.getAttribute(ATTR_H)!==it.h)clear(it.node);
   render(it,groupOf.get(it));
  }
  let checked=0,listed=0,flagged=0,threadHits=0;
  for(const a of byAuthor.values()){checked++;if(a.listed)listed++;if(a.flagged)flagged++;if(a.threadHit)threadHits++;}
  stats={collapsed:live.filter(it=>it.collapse).length,checked,listed,flagged,thread:threadHits};
  // Only what grew since this page last contributed goes to the tally (a count never goes down there).
  if(parsed.length){const delta=pageDelta(committed,{pages:1,compared:checked,listed,flagged,thread:threadHits,collapsed:stats.collapsed});if(delta){queueTally(delta);for(const k of Object.keys(delta))committed[k]=(committed[k]??0)+delta[k];}}
  drawPill();
 }
 function render(it,grouping){
  const {node,username,h,entry,thread:tv,decision}=it;
  const state=grouping?'group':decision.state;
  const chip=chipText({entry,thread:tv,trusted:state==='trusted',fadeAt:settings.fadeAt});
  const stub=grouping?.first?stubText(grouping.group.members):null;
  const key=renderKey(h,decision,`${state}|${chip?chip.tone+chip.text:''}|${stub?stub.title+stub.text:''}|${listState}|${epoch}|${settings.showIcon?1:0}`);
  if(node.getAttribute(ATTR_KEY)===key)return;
  for(const c of node.querySelectorAll(':scope > .whospost-stub, :scope .whospost-chip'))c.remove();
  node.setAttribute(ATTR_H,h);node.setAttribute(ATTR,state);node.setAttribute(ATTR_KEY,key);
  if(grouping?.first){node.setAttribute(ATTR_STUB,'1');node.prepend(stubRow(grouping.group));}else node.removeAttribute(ATTR_STUB);
  if(chip&&state!=='group')placeChip(node,username,chip,it);
  placeIcon(node,username,state);
 }
 const nameLinkOf=(node,username)=>{const links=[...node.querySelectorAll(AUTHOR_SELECTOR)].filter(a=>a.closest('[data-pressable-container]')===node&&usernameFromHref(a.getAttribute('href'))===username);return links.find(a=>a.textContent.trim())??links[0]??null;};
 // The date: the top-level span[dir="auto"] that holds the <time> (measured 2026-10-23: it sits in its own small flex
 // block beside the name, while the row's far end is where Threads keeps its "⋯" menu). The chip goes right after it
 // so it follows the date on the same line.
 function dateBlockOf(node){
  const own=x=>x.closest('[data-pressable-container]')===node;
  const time=[...node.querySelectorAll('time')].find(own);
  if(!time)return null;
  let x=time,top=null;
  while(x&&x!==node){if(x.matches('span[dir="auto"]'))top=x;x=x.parentElement;}
  return top??time.closest('a')??time;
 }
 function placeChip(node,username,chip,it){
  const nameLink=nameLinkOf(node,username);
  const after=dateBlockOf(node);
  const b=button(`whospost-chip whospost-chip-${chip.tone}`,'',()=>openPopover(b,it));
  b.append(el('span','whospost-dot'),doc.createTextNode(chip.text));b.title='為什麼？';
  swallow(b);
  if(after)after.insertAdjacentElement('afterend',b);else if(nameLink)(nameLink.querySelector('span')??nameLink).append(b);else node.firstElementChild?.prepend(b);
 }
 function placeIcon(node,username,state){
  const existing=node.querySelector(':scope .whospost-icon');
  if(!settings.showIcon||!['none','stale'].includes(state)){existing?.remove();return;}
  if(existing)return;
  const author=nameLinkOf(node,username);
  if(!author)return;
  // Inside the name link, right after the name text, shown on hover only: a span, not a nested anchor.
  const icon=el('span','whospost-icon');icon.title='用 Whospost 查這個帳號';icon.setAttribute('role','link');icon.setAttribute('tabindex','0');icon.setAttribute('aria-label','用 Whospost 查這個帳號');icon.innerHTML=ICON_SVG;
  const open=()=>win.open(checkUrl(username),'_blank','noopener,noreferrer');
  icon.addEventListener('click',open);icon.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' ')open();});
  const nameSpan=[...author.querySelectorAll('span')].reverse().find(sp=>sp.textContent.trim()&&!sp.querySelector('span'));
  swallow(icon);(nameSpan??author).append(icon);
 }
 // The folded row (§3 item 1, after Instagram's "查看更多回覆"): stacked avatars, "已收起 N 則", the two most common
 // reasons, and two actions. "顯示" opens the whole run as dimmed replies with chips; "都信任" trusts every account in it.
 function stubRow(group){
  const members=group.members,text=stubText(members);
  const row=el('div','whospost-stub');
  const avatars=el('span','whospost-stub-avatars');
  const seen=new Set();
  for(const m of members){if(seen.has(m.h)||seen.size>=3)continue;seen.add(m.h);const img=[...m.node.querySelectorAll(AUTHOR_SELECTOR)].map(a=>a.querySelector('img')).find(Boolean);const av=el('span','whospost-stub-avatar');if(img?.src){const i=el('img');i.src=img.src;i.alt='';av.append(i);}avatars.append(av);}
  const msg=el('span','whospost-stub-msg');msg.append(el('b',null,text.title));if(text.text)msg.append(doc.createTextNode(' '),el('span','whospost-stub-reasons',text.text));
  const hs=[...new Set(members.map(m=>m.h))],names=[...new Set(members.map(m=>m.username))];
  const show=button('whospost-stub-action whospost-stub-primary','顯示',()=>{for(const h of hs)shown.add(h);showToast(toastText('show',{count:members.length}),()=>{for(const h of hs)shown.delete(h);scheduleScan();});scheduleScan();});
  const trustAll=button('whospost-stub-action','都信任',()=>trustMany(members.map(m=>({h:m.h,username:m.username})),toastText('trustAll',{count:names.length})));
  row.append(avatars,msg,show,trustAll);swallow(row);
  return row;
 }
 async function trustMany(accounts,message){
  const before=trusted;const next={...trusted};const at=Date.now();
  for(const {h,username} of accounts)next[h]={username,at};
  trusted=next;await storage.setTrusted(trusted);epoch++;scheduleScan();
  const presses=new Set(accounts.map(a=>a.h)).size;queueTally({trusted:presses});
  showToast(message,async()=>{trusted=before;await storage.setTrusted(trusted);epoch++;scheduleScan();if(pendingDelta?.trusted)pendingDelta.trusted=Math.max(0,pendingDelta.trusted-presses);});
  for(const {h} of new Map(accounts.map(a=>[a.h,a])).values())runtime.appeal(h).catch(()=>{});
 }
 async function untrust(h,username){
  const before=trusted;const next={...trusted};delete next[h];
  trusted=next;await storage.setTrusted(trusted);epoch++;scheduleScan();
  showToast(toastText('untrust',{username}),async()=>{trusted=before;await storage.setTrusted(trusted);epoch++;scheduleScan();});
 }
 // The "why" popover (§3 item 4): opened from a chip, closed by a click outside, Escape or leaving the page.
 function openPopover(anchor,it){
  closePopover();
  const model=popoverModel({username:it.username,entry:it.entry,thread:it.thread,trusted:!!trusted[it.h],listStatus:listState,generated:listGenerated});
  popover=el('div','whospost-pop');popover.setAttribute('role','dialog');popover.setAttribute('aria-label','Whospost 線索');
  popover.append(el('h4','whospost-pop-title',model.title));
  const chips=el('div','whospost-pop-chips');for(const c of model.chips)chips.append(el('span',`whospost-chip whospost-chip-${it.entry&&Number.isInteger(it.entry.score)?'orange':'blue'} whospost-chip-static`,c));if(model.chips.length)popover.append(chips);
  popover.append(el('p','whospost-pop-line',model.line),el('p','whospost-pop-note',model.note));
  const btns=el('div','whospost-pop-btns');
  btns.append(button('whospost-btn whospost-btn-primary',model.primary.label,()=>{closePopover();if(model.primary.action==='trust')trustMany([{h:it.h,username:it.username}],toastText('trust',{username:it.username}));else untrust(it.h,it.username);}));
  btns.append(link('whospost-btn',model.secondary.label,model.secondary.href));
  popover.append(btns,link('whospost-pop-deletion',model.deletion.label,model.deletion.href));
  swallow(popover);
  doc.documentElement.append(popover);
  position(anchor);
  const onDoc=e=>{if(!popover||popover.contains(e.target)||anchor.contains(e.target))return;closePopover();};
  const onKey=e=>{if(e.key==='Escape')closePopover();};
  const onScroll=()=>{if(anchor.isConnected)position(anchor);else closePopover();};
  doc.addEventListener('mousedown',onDoc,true);doc.addEventListener('keydown',onKey,true);win.addEventListener('scroll',onScroll,{passive:true});
  popover._cleanup=()=>{doc.removeEventListener('mousedown',onDoc,true);doc.removeEventListener('keydown',onKey,true);win.removeEventListener('scroll',onScroll);};
  function position(a){const r=a.getBoundingClientRect(),w=Math.min(360,win.innerWidth-24);const left=Math.max(12,Math.min(r.left,win.innerWidth-w-12));popover.style.width=`${w}px`;popover.style.left=`${left+win.scrollX}px`;popover.style.top=`${r.bottom+6+win.scrollY}px`;}
 }
 function closePopover(){if(!popover)return;popover._cleanup?.();popover.remove();popover=null;}
 // The toast (§3 item 5, after Reddit's "Post hidden · Undo"): one line at the bottom, undoable for TOAST_MS.
 function showToast(message,onUndo){
  hideToast();
  undo=onUndo;
  toast=el('div','whospost-toast');toast.setAttribute('role','status');
  toast.append(el('span',null,message));
  if(onUndo)toast.append(button('whospost-toast-undo','復原',()=>{const u=undo;hideToast();u?.();}));
  swallow(toast);doc.documentElement.append(toast);
  toastTimer=setTimeout(hideToast,TOAST_MS);
 }
 function hideToast(){clearTimeout(toastTimer);toast?.remove();toast=null;undo=null;}
 // The pill (§3 item 6): "已收起 N 則 · 顯示全部" only while something is folded; a grey line when the list is unreadable.
 function drawPill(){
  if(page.kind!=='post'||!settings.enabled){pill?.remove();pill=null;note?.remove();note=null;return;}
  const text=health==='broken'?{title:LAYOUT_CHANGED,action:null}:pillText(stats.collapsed);
  if(!text){pill?.remove();pill=null;}
  else{
   if(!pill){pill=el('div','whospost-pill');swallow(pill);doc.documentElement.append(pill);}
   pill.textContent='';pill.setAttribute('data-whospost-health',health);
   pill.append(button('whospost-pill-title',text.title,()=>runtime.openPopup()));
   if(text.action)pill.append(button('whospost-pill-action',text.action,()=>{const hs=[...collapsedHashes],n=stats.collapsed;for(const h of hs)shown.add(h);showToast(toastText('showAll',{count:n}),()=>{for(const h of hs)shown.delete(h);scheduleScan();});scheduleScan();}));
  }
  if(listState==='missing'&&health!=='broken'){if(!note){note=el('div','whospost-note',LIST_UNREADABLE);note.title='Whospost 的清單暫時讀不到；本串觀察與你的信任標記照常。';swallow(note);doc.documentElement.append(note);}note.classList.toggle('whospost-note-raised',!!pill);}
  else{note?.remove();note=null;}
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
   win.addEventListener('pagehide',flushTally);
   scheduleScan();
   runtime.ensureList().then(l=>{if(l){setList(l);scheduleScan();}}).catch(()=>{});
  },
  scheduleScan,
  get state(){return {health,listState,stats,page,settings};}
 };
}
export {SITE};
