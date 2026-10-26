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
import {chipText,nameMarks,popoverModel,stubText,pillText,toastText,LIST_UNREADABLE,LAYOUT_CHANGED,LIVE_LABEL,LIVE_TITLE,SITE} from './label.mjs';
import {pageDelta,mergeDelta} from './report.mjs';
import {liveFromView,pollDelay,pruneResults,withResult,taipeiTime} from './live.mjs';
import {createProfileRunner} from './profile-runner.mjs';
import {newAccountMark} from './profile.mjs';
import {backgroundSection,NEW_MARK,NEW_TITLE,PAUSED_TEXT} from './profile-label.mjs';
import {placeMark} from './country-flag.mjs';
import {blockButtonText,blockToastText} from './label.mjs';
import {cooldownLeft,newIntent,BLOCK_COOLDOWN_MS} from './block.mjs';
import {blockEnabled} from './flags.mjs';
const BROKEN_SCANS=3,STATS_THROTTLE=500,TOAST_MS=5000,TALLY_DELAY=5000;
// Room kept free at the end of the name's line for Threads' own 「⋯」 when deciding whether the reason chips fit.
const REASON_END_GAP=48;
const ATTR='data-whospost',ATTR_H='data-whospost-h',ATTR_KEY='data-whospost-key',ATTR_STUB='data-whospost-stub';
const ICON_SVG='<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10.5 10.5 14 14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
const idle=cb=>(globalThis.requestIdleCallback??(f=>setTimeout(()=>f({timeRemaining:()=>50}),50)))(cb,{timeout:500});
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;};
const button=(cls,text,onClick)=>{const b=el('button',cls,text);b.type='button';b.addEventListener('click',onClick);return b;};
const link=(cls,label,href)=>{const a=el('a',cls,label);a.href=href;a.target='_blank';a.rel='noopener noreferrer';return a;};
// Threads opens the post on almost any pointer event inside a container, so our own widgets swallow them; a real link
// inside still navigates (only propagation is stopped), everything else is prevented too.
// A link of our own (inside the widget) still navigates; a Threads link the widget happens to sit in does not.
const swallow=node=>{for(const type of ['click','mousedown','mouseup','pointerdown','pointerup','touchstart','touchend','keydown'])node.addEventListener(type,e=>{e.stopPropagation();if(type==='click'){const l=e.target.closest('a[href]');if(!(l&&node.contains(l)))e.preventDefault();}});};
export function createEngine({storage,runtime,doc=document,win=window}){
 const hashes=createHashCache();
 const thread=createThread();
 const nodeIds=new WeakMap();let nextNodeId=1;
 const nodeId=n=>{let id=nodeIds.get(n);if(!id){id=`n${nextNodeId++}`;nodeIds.set(n,id);}return id;};
 let settings=mergeSettings(null),trusted={},list=indexList([]),listState='missing';
 let page={kind:'other'},lastPath=null,shown=new Set(),health='ok',brokenRuns=0,epoch=0;
 let stats={collapsed:0,checked:0,listed:0,flagged:0,thread:0,live:0},statsTimer=null,queued=false,observer=null;
 // 即時查 (§4.3): per account hash, what this page knows about a check the user started (scanning / partial / done /
 // failed, with the entry when there is one). Finished results also go to chrome.storage.local (lib/live.mjs) so a
 // reload or another tab keeps them until the hourly list carries the account. Keyed by account, so it survives resetPage.
 const liveChecks=new Map();let liveSaved={},liveStarted=0;
 let pill=null,note=null,popover=null,toast=null,toastTimer=null,undo=null;
 const byAuthor=new Map(); // username → {h, entry, listed, flagged, threadHit}
 let collapsedHashes=new Set();
 // 封鎖助手 (§4.5): the local blocked list, the site's switch, and when the next press is allowed (shared by every tab).
 let blocked={},flags=null,cooldownUntil=0;
 // 「回報貢獻」(lib/report.mjs): what this page has already contributed to today's tally, and the batch not yet handed over.
 let committed={},pendingDelta=null,tallyTimer=null;
 // 帳號背景 (§4.4, lib/profile-runner.mjs): looked up for the chip-carrying authors on screen only; null without the
 // background routes (tests that do not wire them).
 const profiles=runtime.profileSlot?createProfileRunner({runtime,doc,onUpdate:()=>scheduleScan()}):null;
 // What goes beside the name and in the popover section for one author: {place, isNew, sig, view}.
 function profileView(username,{threadReplies=0,listed=false}={}){
  if(!profiles||!settings.profileLookup)return null;
  const view=profiles.get(username),data=view.status==='ok'?view.data:null;
  const isNew=newAccountMark({data,threadReplies,barAt:settings.thread.barAt,listed});
  const place=placeMark(data?.country);
  return {place,isNew,view,sig:`${view.status}|${place?.text??''}|${isNew?1:0}`};
 }
 function queueTally(delta){if(!delta||!settings.report)return;pendingDelta=mergeDelta(pendingDelta,delta);if(!tallyTimer)tallyTimer=setTimeout(flushTally,TALLY_DELAY);}
 function flushTally(){clearTimeout(tallyTimer);tallyTimer=null;if(!pendingDelta)return;const delta=pendingDelta;pendingDelta=null;Promise.resolve(runtime.tally?.(delta)).catch(()=>{});}
 function setList(cache){list=indexList(cache?.accounts);listState=listStatus(cache);}
 function setSettings(saved){settings=mergeSettings(saved);epoch++;}
 function setTrusted(saved){trusted=saved&&typeof saved==='object'?saved:{};epoch++;}
 function resetPage(){
  flushTally();committed={};
  profiles?.resetPage();
  thread.reset();shown=new Set();byAuthor.clear();collapsedHashes=new Set();stats={collapsed:0,checked:0,listed:0,flagged:0,thread:0,live:0};liveStarted=0;
  for(const n of doc.querySelectorAll(`[${ATTR}]`))clear(n);
  for(const n of doc.querySelectorAll('.whospost-live,.whospost-chip,.whospost-stub,.whospost-bg'))n.remove();
  closePopover();
 }
 function clear(n){n.removeAttribute(ATTR);n.removeAttribute(ATTR_H);n.removeAttribute(ATTR_KEY);n.removeAttribute(ATTR_STUB);for(const c of n.querySelectorAll(':scope > .whospost-stub, :scope .whospost-chip, :scope .whospost-live, :scope .whospost-bg'))c.remove();}
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
   if(root&&!root.contains(node)){if(node.hasAttribute(ATTR))clear(node);node.querySelector(':scope .whospost-live')?.remove();continue;}
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
   // The list wins; a live result (this page, or one saved within the hour) stands in for a missing entry.
   const lv=liveChecks.get(h)??(liveSaved[h]?{status:'done',entry:liveSaved[h].entry,scanId:liveSaved[h].entry?.scanId??null}:null);
   const entry=list.get(h)??(lv&&lv.entry&&(lv.status==='done'||lv.status==='partial')?{...lv.entry,h,live:true,partial:lv.status==='partial'}:null);
   const tv=first[i]?threadVerdict(thread.observe(info.username),settings.thread):NO_THREAD;
   const decision=decide({trusted:!!trusted[h],blocked:!!blocked[h],shown:shown.has(h),entry:list.get(h)??null,thread:tv,listStatus:listState,settings,mode,live:lv});
   if(first[i])byAuthor.set(info.username,{h,entry,listed:decision.listed,flagged:decision.flagged,threadHit:decision.threadHit});
   const bg=first[i]?profileView(info.username,{threadReplies:tv.replies??0,listed:decision.listed}):null;
   return {node,username:info.username,h,entry,live:lv,thread:decision.threadHit?tv:null,decision,collapse:decision.state==='collapse',first:first[i],bg};
  }));
  const live=items.filter(it=>it.node.isConnected);
  const groups=groupRuns(live);
  const groupOf=new Map();groups.forEach((g,i)=>g.members.forEach((m,j)=>groupOf.set(m,{index:i,first:j===0,group:g})));
  collapsedHashes=new Set(live.filter(it=>it.collapse).map(it=>it.h));
  if(profiles&&settings.profileLookup)profiles.want(onScreenChipAuthors(live,groupOf));
  for(const it of live){
   // A node React recycled for another account must not keep the old account's mark.
   if(it.node.getAttribute(ATTR_H)&&it.node.getAttribute(ATTR_H)!==it.h)clear(it.node);
   render(it,groupOf.get(it));
  }
  let checked=0,listed=0,flagged=0,threadHits=0;
  for(const a of byAuthor.values()){checked++;if(a.listed)listed++;if(a.flagged)flagged++;if(a.threadHit)threadHits++;}
  stats={collapsed:live.filter(it=>it.collapse).length,checked,listed,flagged,thread:threadHits,live:liveStarted};
  // Only what grew since this page last contributed goes to the tally (a count never goes down there).
  if(parsed.length){const delta=pageDelta(committed,{pages:1,compared:checked,listed,flagged,thread:threadHits,collapsed:stats.collapsed});if(delta){queueTally(delta);for(const k of Object.keys(delta))committed[k]=(committed[k]??0)+delta[k];}}
  drawPill();
 }
 function render(it,grouping){
  const {node,username,h,entry,thread:tv,decision}=it;
  const state=grouping?'group':decision.state;
  const chip=state==='blocked'?null:chipText({entry,thread:tv,trusted:state==='trusted',fadeAt:settings.fadeAt,live:it.live});
  const stub=grouping?.first?stubText(grouping.group.members):null;
  const key=renderKey(h,decision,`${state}|${chip?chip.tone+chip.text:''}|${stub?stub.title+stub.text:''}|${listState}|${epoch}|${settings.showIcon?1:0}|${it.live?.status??''}|${it.bg?.sig??''}`);
  if(node.getAttribute(ATTR_KEY)===key)return;
  for(const c of node.querySelectorAll(':scope > .whospost-stub, :scope .whospost-chip, :scope .whospost-bg'))c.remove();
  node.setAttribute(ATTR_H,h);node.setAttribute(ATTR,state);node.setAttribute(ATTR_KEY,key);
  if(grouping?.first){node.setAttribute(ATTR_STUB,'1');node.prepend(stubRow(grouping.group));}else node.removeAttribute(ATTR_STUB);
  if(chip&&state!=='group')placeChip(node,username,chip,it);
  placeLive(node,username,state,it);
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
 // Beside the name (Felix 10-24): a checked account's reason chips, clickable, in the tone its score had (the score
 // chip itself is not drawn; the fold still counts it); a status chip instead (已信任, 查詢中…, 快篩…, 本串); then
 // 帳號背景's 新帳號 and the place as a flag. When the reason chips do not all fit on the name's line (they wrap, or
 // run into the row's far end where Threads keeps its 「⋯」), only the first stays.
 function placeChip(node,username,chip,it){
  const marks=nameMarks({chip,entry:it.entry});
  const nameLink=nameLinkOf(node,username);
  const after=dateBlockOf(node);
  const nodes=[],reasons=[];
  const opener=(cls,text,{dot=false,busy=false}={})=>{
   const b=button(cls,'',()=>{if(!busy)openPopover(b,it);});
   if(dot)b.append(el('span','whospost-dot'));b.append(doc.createTextNode(text));
   b.title=busy?'Whospost 正在查這個帳號':'為什麼？';if(busy)b.setAttribute('aria-busy','true');
   swallow(b);nodes.push(b);return b;
  };
  if(marks.chip)opener(`whospost-chip whospost-chip-${chip.tone}${chip.busy?' whospost-chip-busy':''}${chip.partial?' whospost-chip-partial':''}`,chip.text,{dot:true,busy:chip.busy});
  for(const r of marks.reasons)reasons.push(opener(`whospost-chip whospost-chip-${marks.tone} whospost-chip-reason`,r));
  if(it.bg?.isNew){const mark=el('span','whospost-bg whospost-bg-new',NEW_MARK);mark.title=NEW_TITLE;nodes.push(mark);}
  if(it.bg?.place){const p=el('span',`whospost-bg whospost-bg-place${it.bg.place.flag?' whospost-bg-flag':''}`,it.bg.place.text);p.title=it.bg.place.title;p.setAttribute('aria-label',it.bg.place.title);nodes.push(p);}
  if(!nodes.length)return;
  if(after)after.insertAdjacentElement('afterend',nodes[0]);else if(nameLink)(nameLink.querySelector('span')??nameLink).append(nodes[0]);else node.firstElementChild?.prepend(nodes[0]);
  for(let i=1;i<nodes.length;i++)nodes[i-1].insertAdjacentElement('afterend',nodes[i]);
  const box=node.getBoundingClientRect();
  // Not laid out (a hidden row, a test DOM): nothing to measure, so all stay.
  if(reasons.length>1&&box.width>0){
   const top=reasons[0].getBoundingClientRect().top,end=box.right-REASON_END_GAP;
   const r=reasons.at(-1).getBoundingClientRect();
   if(Math.abs(r.top-top)>=4||r.right>end)for(const c of reasons.slice(1))c.remove();
  }
  // A re-render (帳號背景 arriving, say) replaces the chip under an open popover: move it to the new chip, refreshed.
  const anchor=nodes.find(n=>n.tagName==='BUTTON');
  if(anchor&&popover?._h===it.h&&!popover._anchor.isConnected)openPopover(anchor,it);
 }
 // The chip-carrying first replies whose row is on screen now (not the scan band): the only authors looked up.
 function onScreenChipAuthors(items,groupOf){
  const h=win.innerHeight||0,out=[];
  for(const it of items){
   if(!it.first||it.decision.state==='trusted'||groupOf.get(it)||!(it.decision.listed||it.decision.threadHit))continue;
   const r=it.node.getBoundingClientRect();if(r.bottom>0&&r.top<h)out.push(it.username);
  }
  return out;
 }
 // The 即時查 control (§4.3, replacing the magnifier of §10 #4): beside the name of an account that is not on the list and
 // not being checked, shown on hover only; a press starts the check in place. Inside the name link, as a span.
 function placeLive(node,username,state,it){
  const existing=node.querySelector(':scope .whospost-live');
  // Any account on the list was already checked by someone (Felix 10-26: everyone's results reach everyone), even one
  // with nothing found that draws no chip: no 即時查 for it.
  if(!settings.showIcon||it.entry||!['none','stale'].includes(state)||['scanning','partial','done'].includes(it.live?.status)){existing?.remove();return;}
  // A control left by a React-recycled node belongs to another account: its closure would check the wrong name.
  if(existing){if(existing.dataset.whospostUser===username)return;existing.remove();}
  const author=nameLinkOf(node,username);
  if(!author)return;
  const control=el('span','whospost-live');control.dataset.whospostUser=username;control.title=LIVE_TITLE;control.setAttribute('role','button');control.setAttribute('tabindex','0');control.setAttribute('aria-label',LIVE_TITLE);
  control.innerHTML=ICON_SVG;control.append(el('span','whospost-live-label',LIVE_LABEL));
  // Inside the name link, so the press must not follow it (swallow() leaves the default to real links).
  const start=e=>{e.preventDefault();e.stopPropagation();startLive(it);};
  control.addEventListener('click',start);control.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' ')start(e);});
  const nameSpan=[...author.querySelectorAll('span')].reverse().find(sp=>sp.textContent.trim()&&!sp.querySelector('span'));
  swallow(control);(nameSpan??author).append(control);
 }
 // 即時查: POST once through the background script, then poll the status route until the result (partial first, then
 // full), a failure, or POLL_MAX_MS. The user keeps scrolling; nothing here blocks. Failure keeps the account "not checked".
 async function startLive(it){
  const {h,username}=it;
  if(['scanning','partial'].includes(liveChecks.get(h)?.status))return;
  liveChecks.set(h,{status:'scanning',scanId:null,progress:'',at:Date.now()});liveStarted++;epoch++;scheduleScan();
  const fail=(code,message,when)=>{liveChecks.set(h,{status:'failed',code,message,at:Date.now()});epoch++;scheduleScan();showToast(code==='HOURLY_LIMIT'?toastText('liveLimit',{when}):toastText('liveFailed',{username,reason:message}),()=>startLive(it),'再試一次');};
  let started;
  try{started=await runtime.liveStart(username);}catch{started=null;}
  if(!started?.ok){fail(started?.code??'NETWORK',started?.message??'連不上 Whospost',started?.retryAt?taipeiTime(started.retryAt):'');return;}
  showToast(toastText('liveStarted',{username}));
  const scanId=started.scanId,begun=Date.now();let sawPartial=null;
  const settle=next=>{liveChecks.set(h,next);epoch++;scheduleScan();};
  const poll=async()=>{
   if(liveChecks.get(h)?.scanId!==scanId&&liveChecks.get(h)?.status!=='scanning')return;
   let answer;try{answer=await runtime.livePoll(scanId);}catch{answer=null;}
   const view=answer?.ok?answer.view:null;
   const next=view?liveFromView(view,{h}):{status:'scanning',scanId,progress:'',at:Date.now()};
   if(next.status==='done'){settle(next);liveSaved=withResult(liveSaved,h,next.entry);storage.setLive?.(liveSaved).catch?.(()=>{});showToast(toastText('liveDone',{username}));return;}
   if(next.status==='failed'){fail(next.code,next.message);return;}
   if(next.status==='partial'){sawPartial=next;settle({...next,scanId});}
   else liveChecks.set(h,{...next,scanId});
   const delay=pollDelay(Date.now()-begun);
   if(delay===null){if(sawPartial){showToast(toastText('liveTimeout',{username}));return;}fail('TIMEOUT','等太久了');return;}
   setTimeout(poll,delay);
  };
  setTimeout(poll,1200);
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
 // The "why" popover (§3 item 4): opened from a chip, closed by a click outside, Escape or leaving the page.
 function openPopover(anchor,it){
  closePopover();
  const model=popoverModel({username:it.username,entry:it.entry,thread:it.thread,live:it.live,liveAvailable:settings.showIcon});
  popover=el('div','whospost-pop');popover.setAttribute('role','dialog');popover.setAttribute('aria-label','Whospost 線索');
  // The reason chips sit on the title's line, to its right (Felix 10-24).
  const head=el('div','whospost-pop-head');head.append(el('h4','whospost-pop-title',model.title));
  const tone=it.entry&&Number.isInteger(it.entry.score)&&it.entry.score>=settings.fadeAt?'orange':'grey';
  for(const c of model.chips)head.append(el('span',`whospost-chip whospost-chip-${tone} whospost-chip-static`,c));
  popover.append(head);
  // The AI summary sits right under the bare 「@xx」 title (Felix 10-24), with no heading of its own.
  if(model.ai){const ai=el('div','whospost-pop-ai');ai.append(el('p','whospost-pop-ai-text',model.ai.text),el('p','whospost-pop-ai-source',model.ai.source));popover.append(ai);}
  if(model.line)popover.append(el('p','whospost-pop-line',model.line));
  if(model.note)popover.append(el('p','whospost-pop-note',model.note));
  // Felix 10-24: the evidence (or 即時查) is the filled button, to lead there; 「封鎖 @xx」 beside it is outlined.
  const btns=el('div','whospost-pop-btns');
  const blockCta=blockButton(it);if(blockCta)btns.append(blockCta);
  if(model.secondary.action==='live')btns.append(button('whospost-btn whospost-btn-primary',model.secondary.label,()=>{closePopover();startLive(it);}));
  else if(model.secondary.action==='none'){const b=el('span','whospost-btn whospost-btn-static',model.secondary.label);btns.append(b);}
  else btns.append(link('whospost-btn whospost-btn-primary',model.secondary.label,model.secondary.href));
  const links=el('div','whospost-pop-links');
  if(model.site)links.append(link('whospost-pop-deletion',model.site.label,model.site.href));
  popover.append(btns);if(links.childElementCount)popover.append(links);
  appendBackgroundSection(popover,it);
  swallow(popover);
  popover._h=it.h;popover._anchor=anchor;
  doc.documentElement.append(popover);
  position(anchor);
  const onDoc=e=>{if(!popover||popover.contains(e.target)||anchor.contains(e.target))return;closePopover();};
  const onKey=e=>{if(e.key==='Escape')closePopover();};
  const onScroll=()=>{if(anchor.isConnected)position(anchor);else closePopover();};
  doc.addEventListener('mousedown',onDoc,true);doc.addEventListener('keydown',onKey,true);win.addEventListener('scroll',onScroll,{passive:true});
  popover._cleanup=()=>{doc.removeEventListener('mousedown',onDoc,true);doc.removeEventListener('keydown',onKey,true);win.removeEventListener('scroll',onScroll);};
  if(blockCta){const cleanup=popover._cleanup;popover._cleanup=()=>{blockCta._stop();cleanup();};}
  function position(a){const r=a.getBoundingClientRect(),w=Math.min(360,win.innerWidth-24);const left=Math.max(12,Math.min(r.left,win.innerWidth-w-12));popover.style.width=`${w}px`;popover.style.left=`${left+win.scrollX}px`;popover.style.top=`${r.bottom+6+win.scrollY}px`;}
 }
 // The popover's 「帳號背景」 part (§4.4): what Threads shows and the 新帳號 note; or why there is nothing.
 function appendBackgroundSection(pop,it){
  const bg=profileView(it.username,{threadReplies:thread.observe(it.username).replies,listed:!!it.entry});
  if(!bg)return;
  const s=backgroundSection({state:bg.view.status,data:bg.view.data,isNew:bg.isNew,retryAt:profiles.retryAt?taipeiTime(profiles.retryAt):''});
  const box=el('div','whospost-pop-bg');box.append(el('h5','whospost-pop-bg-title',s.title));
  if(s.rows.length){const dl=el('dl','whospost-pop-bg-rows');for(const [k,v] of s.rows)dl.append(el('dt',null,k),el('dd',null,v));box.append(dl);}
  if(s.status)box.append(el('p','whospost-pop-bg-status',s.status));
  if(s.newNote)box.append(el('p','whospost-pop-bg-new',s.newNote));
  pop.append(box);
 }
 // 封鎖助手 (§4.5): the popover's 「封鎖 @xx」 button (outlined, left of the filled evidence button), only while the site's switch is on. For BLOCK_COOLDOWN_MS
 // after any press (in any tab) it is grey and counts down. A press hands the account over through storage and opens
 // its profile in a new tab, where lib/block-page.mjs does the clicking. null when the switch is off.
 function blockButton(it){
  if(!blockEnabled(flags))return null;
  const b=button('whospost-btn whospost-btn-block','',()=>startBlock(it));
  const paint=()=>{const t=blockButtonText({username:it.username,wait:cooldownLeft(cooldownUntil)});if(b.textContent!==t.label)b.textContent=t.label;b.disabled=t.disabled;b.setAttribute('aria-disabled',String(t.disabled));};
  paint();const timer=setInterval(paint,250);b._stop=()=>clearInterval(timer);
  return b;
 }
 async function startBlock(it){
  if(!blockEnabled(flags)||cooldownLeft(cooldownUntil)>0)return;
  const intent=newIntent({username:it.username,h:it.h});
  if(!intent)return;
  cooldownUntil=Date.now()+BLOCK_COOLDOWN_MS;
  try{await storage.setBlockIntent(intent);await storage.setCooldownUntil(cooldownUntil);}catch{return;}
  win.open(`${win.location.origin}/@${intent.username}`,'_blank','noopener');
  showToast(blockToastText({username:intent.username}));
 }
 function closePopover(){if(!popover)return;popover._cleanup?.();popover.remove();popover=null;}
 // The toast (§3 item 5, after Reddit's "Post hidden · Undo"): one line at the bottom, undoable for TOAST_MS.
 function showToast(message,onUndo,label='復原'){
  hideToast();
  undo=onUndo;
  toast=el('div','whospost-toast');toast.setAttribute('role','status');
  toast.append(el('span',null,message));
  if(onUndo)toast.append(button('whospost-toast-undo',label,()=>{const u=undo;hideToast();u?.();}));
  swallow(toast);doc.documentElement.append(toast);
  toastTimer=setTimeout(hideToast,TOAST_MS);
 }
 function hideToast(){clearTimeout(toastTimer);toast?.remove();toast=null;undo=null;}
 // The pill (§3 item 6): "已收起 N 則 · 顯示全部" only while something is folded; a grey line when the list is unreadable.
 function drawPill(){
  if(page.kind!=='post'||!settings.enabled){pill?.remove();pill=null;note?.remove();note=null;return;}
  const bgPaused=Boolean(profiles&&settings.profileLookup&&profiles.blocked==='paused');
  let text=health==='broken'?{title:LAYOUT_CHANGED,action:null}:pillText(stats.collapsed);
  // 帳號背景 stopped by the stop rule says so here, never silently (§4.4 rule 3).
  if(bgPaused)text=text?{...text,extra:PAUSED_TEXT}:{title:PAUSED_TEXT,action:null};
  if(!text){pill?.remove();pill=null;}
  else{
   if(!pill){pill=el('div','whospost-pill');swallow(pill);doc.documentElement.append(pill);}
   // Rebuilt only when what it says changes: every rebuild is a mutation the observer turns into another scan, so an
   // unconditional rebuild kept the scan loop running for as long as anything was folded. The handlers read
   // collapsedHashes and stats at click time, so they never go stale.
   const sig=`${health}|${text.title}|${text.action??''}|${text.extra??''}`;
   if(pill.dataset.whospostSig!==sig){
    pill.dataset.whospostSig=sig;pill.textContent='';pill.setAttribute('data-whospost-health',health);
    pill.append(button('whospost-pill-title',text.title,()=>runtime.openPopup()));
    if(text.action)pill.append(button('whospost-pill-action',text.action,()=>{const hs=[...collapsedHashes],n=stats.collapsed;for(const h of hs)shown.add(h);showToast(toastText('showAll',{count:n}),()=>{for(const h of hs)shown.delete(h);scheduleScan();});scheduleScan();}));
    if(text.extra)pill.append(el('span','whospost-pill-extra',text.extra));
   }
  }
  if(listState==='missing'&&health!=='broken'){if(!note){note=el('div','whospost-note',LIST_UNREADABLE);note.title='Whospost 的清單暫時讀不到；本串觀察與你的信任標記照常。';swallow(note);doc.documentElement.append(note);}note.classList.toggle('whospost-note-raised',!!pill);}
  else{note?.remove();note=null;}
  if(!statsTimer)statsTimer=setTimeout(()=>{statsTimer=null;storage.setPageStats({...stats,health,listStatus:listState,page:page.kind,at:Date.now()}).catch(()=>{});},STATS_THROTTLE);
 }
 function scheduleScan(){if(queued)return;queued=true;idle(()=>{scan().catch(e=>{queued=false;console.warn('[whospost] scan failed',e);});});}
 return {
  async start(){
   const [saved,trustedSaved,listSaved,liveSavedRaw,profilesSaved]=await Promise.all([storage.getSettings(),storage.getTrusted(),storage.getList(),storage.getLive?.()??null,storage.getProfiles?.()??null]);
   const blockSaved=await storage.getBlockState?.().catch(()=>null);
   blocked=blockSaved?.blocked??{};flags=blockSaved?.flags??null;cooldownUntil=blockSaved?.cooldownUntil??0;
   setSettings(saved);setTrusted(trustedSaved);setList(listSaved);liveSaved=pruneResults(liveSavedRaw);profiles?.setCache(profilesSaved);
   storage.onChange(({settings:s,trusted:t,list:l,live:lv,profiles:pf,profileSwitch})=>{let changed=false;if(pf!==undefined)profiles?.setCache(pf);if(s!==undefined||profileSwitch)profiles?.resume();if(s!==undefined){setSettings(s);changed=true;}if(t!==undefined){setTrusted(t);changed=true;}if(l!==undefined){setList(l);epoch++;changed=true;}if(lv!==undefined){liveSaved=pruneResults(lv);epoch++;changed=true;}if(changed)scheduleScan();});
   storage.onBlockChange?.(({blocked:b,flags:f,cooldownUntil:c})=>{if(f!==undefined)flags=f;if(c!==undefined)cooldownUntil=c??0;if(b!==undefined){blocked=b&&typeof b==='object'?b:{};epoch++;scheduleScan();}});
   observer=new MutationObserver(scheduleScan);observer.observe(doc.documentElement,{childList:true,subtree:true});
   win.addEventListener('scroll',scheduleScan,{passive:true});
   win.addEventListener('pagehide',flushTally);
   scheduleScan();
   runtime.ensureList().then(l=>{if(l){setList(l);scheduleScan();}}).catch(()=>{});
  },
  scheduleScan,
  get state(){return {health,listState,stats,page,settings};},
  startLive:username=>{const it=[...byAuthor.entries()].find(([u])=>u===String(username).toLowerCase());return it?startLive({h:it[1].h,username:it[0]}):Promise.resolve();}
 };
}
export {SITE};
