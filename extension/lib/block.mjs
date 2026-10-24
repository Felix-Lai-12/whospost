// 封鎖助手 (EXTENSION-SPEC §4.5, §10.3 #21), after davidberger1210/threads-report-block (MIT) but only its block half:
// the user presses 「到 Threads 封鎖 @xx」 in the popover; the account's profile opens in a new tab and the extension
// clicks Threads' own 「⋯ → 封鎖 → 確認」 for them. One account per press, 8 seconds between presses, no batch, no
// built-in list, no report. Each step looks for its element by structure; when it is not there (or there is more than
// one), the run stops where it is and says so: no guessing, no retry, no fallback to text search across the page.
// Pure helpers first (cooldown, the hand-over between tabs, the local blocked list), then the step runner, which takes
// the page through a small adapter so the order and the stop-on-miss rule are tested without a browser, and last the
// adapter for Threads' profile page (measured 2026-10-24 in a logged-in Chrome, English UI, on /@zuck):
//   ⋯       the only div[role="button"][aria-haspopup="dialog"] outside reply containers (its svg's <title> is "More";
//           the top bar's two "More" buttons say aria-haspopup="menu", the posts' ⋯ sit inside data-pressable-container)
//   menu    one [role="menu"]; its [role="menuitem"]s come in three groups (one parent each): Copy link · About this
//           profile · Add to feed / Mute · Restrict / Block · Report. Block is the first item of the last group.
//   confirm a [role="dialog"] titled "Block zuck?" holding two [role="button"]s, Block and Cancel; Block shares the menu
//           item's label, which is how it is told apart without a word list of its own.
// After a block (real run 2026-10-24 on /@zuck, unblocked right after): the dialog closes, Follow becomes Unblock, the
// posts give way to "Content not available", and the ⋯ menu's last group starts with Unblock — which runBlock reports as
// 'already' without pressing anything else.
export const BLOCK_COOLDOWN_MS=8000;
// The new tab must pick the hand-over up soon after the press; anything older is a leftover and is ignored.
export const INTENT_TTL_MS=30000;
// The menu item's own label, per language actually seen (en measured 10-24; zh-TW from threads-report-block, which
// matches 「封鎖」 and 「解除封鎖」). Any other label stops the run: the item in that place is not known to be Block.
export const BLOCK_LABELS=Object.freeze(['Block','封鎖']);
export const UNBLOCK_LABELS=Object.freeze(['Unblock','解除封鎖']);
export const STEPS=Object.freeze(['menuButton','blockItem','confirmButton','confirmClosed']);
export const STEP_TEXT=Object.freeze({menuButton:'找不到個人頁的「⋯」按鈕',blockItem:'「⋯」選單裡找不到「封鎖」',confirmButton:'找不到封鎖的確認視窗',confirmClosed:'按了確認，但確認視窗沒有關上'});
// How long each step waits for its element to appear (the profile loads after the tab opens; menus and dialogs animate).
export const STEP_TIMEOUT_MS=Object.freeze({menuButton:12000,blockItem:3000,confirmButton:3000,confirmClosed:5000});
const USERNAME=/^[a-z0-9_.]{1,30}$/;
/** Whole seconds left before the next press is allowed (0 = now). */
export const cooldownLeft=(until,now=Date.now())=>Number.isFinite(until)&&until>now?Math.ceil((until-now)/1000):0;
/** The hand-over written by the tab where the button was pressed, read once by the profile tab. */
export function newIntent({username,h},now=Date.now()){
 const u=String(username??'').toLowerCase();
 return USERNAME.test(u)&&/^[a-f0-9]{64}$/.test(h??'')?{username:u,h,at:now}:null;
}
/** The intent when it is meant for this page (its /@username, pressed within INTENT_TTL_MS), else null. */
export function intentFor(intent,pathname,now=Date.now()){
 if(!intent||!USERNAME.test(intent.username??'')||!Number.isFinite(intent.at))return null;
 if(now-intent.at>INTENT_TTL_MS||now<intent.at-1000)return null;
 const m=String(pathname??'').match(/^\/@([^/?#]+)\/?$/);
 return m&&m[1].toLowerCase()===intent.username?intent:null;
}
// The local blocked list: {h: {username, at}} in chrome.storage.local, never sent anywhere. Accounts on it are not
// marked or folded any more (Threads stops showing their replies anyway).
export const withBlocked=(blocked,{h,username},now=Date.now())=>({...(blocked&&typeof blocked==='object'?blocked:{}),[h]:{username,at:now}});
export function withoutBlocked(blocked,h){const next={...(blocked&&typeof blocked==='object'?blocked:{})};delete next[h];return next;}
/** What the popup shows for the list: reading it, could not read it, nothing on it, or the accounts newest first.
 *  Three different answers, never one standing in for another: a failed read is not an empty list. */
export function blockedListView({status,blocked}={}){
 if(status==='loading')return {state:'loading',count:null,items:[]};
 if(status!=='ok'||(blocked!=null&&typeof blocked!=='object'))return {state:'error',count:null,items:[]};
 const items=Object.entries(blocked??{}).map(([h,v])=>({h,username:v?.username??h.slice(0,8),at:v?.at??0})).sort((a,b)=>b.at-a.at);
 return items.length?{state:'list',count:items.length,items}:{state:'empty',count:0,items:[]};
}
/** 'block', 'unblock' or null for a menu item's label. */
export function classifyMenuItem(text){
 const t=String(text??'').trim();
 return BLOCK_LABELS.includes(t)?'block':UNBLOCK_LABELS.includes(t)?'unblock':null;
}
/** Groups of {el, text} in page order → the first item of the last group when it is Block (or Unblock), else null. */
export function pickBlockItem(groups){
 const last=Array.isArray(groups)?groups.at(-1):null,item=last?.[0];
 const kind=item?classifyMenuItem(item.text):null;
 return kind?{kind,label:item.text.trim(),el:item.el}:null;
}
/** Runs the steps through `dom` (see threadsProfileDom). Each step waits up to its timeout for its element, clicks it
 *  once, and moves on; the first step whose element never shows stops the run with that step's name. Nothing is
 *  clicked twice. stopBeforeConfirm leaves the confirm dialog open (used to check the steps on a real account).
 *  @returns {Promise<{ok:true,status:'blocked'|'already'|'dry'}|{ok:false,step:string,index:number,reason:string}>} */
export async function runBlock({username,dom,sleep=ms=>new Promise(r=>setTimeout(r,ms)),now=Date.now,interval=150,timeouts=STEP_TIMEOUT_MS,stopBeforeConfirm=false,onStep=()=>{}}){
 const waitFor=async(fn,ms)=>{const end=now()+ms;for(;;){const v=fn();if(v)return v;if(now()>=end)return null;await sleep(interval);}};
 const stop=step=>({ok:false,step,index:STEPS.indexOf(step)+1,reason:STEP_TEXT[step]});
 onStep('menuButton');
 const button=await waitFor(()=>dom.menuButton(),timeouts.menuButton);
 if(!button)return stop('menuButton');
 dom.click(button);
 onStep('blockItem');
 const item=await waitFor(()=>dom.blockItem(),timeouts.blockItem);
 if(!item)return stop('blockItem');
 if(item.kind==='unblock')return {ok:true,status:'already'};
 dom.click(item.el);
 onStep('confirmButton');
 const confirm=await waitFor(()=>dom.confirmButton(item.label,username),timeouts.confirmButton);
 if(!confirm)return stop('confirmButton');
 if(stopBeforeConfirm)return {ok:true,status:'dry'};
 dom.click(confirm.el);
 onStep('confirmClosed');
 const closed=await waitFor(()=>dom.closed(confirm.dialog),timeouts.confirmClosed);
 return closed?{ok:true,status:'blocked'}:stop('confirmClosed');
}
const visible=el=>{const r=el.getBoundingClientRect?.();return !!r&&r.width>0&&r.height>0;};
const textOf=el=>String(el.innerText??el.textContent??'').trim();
/** The adapter for Threads' profile page (measurements in the header comment). Every finder returns null unless
 *  exactly one element fits, so two candidates stop the run the same way none does. */
export function threadsProfileDom(doc){
 const ours=el=>!!el.closest('.whospost-pop,.whospost-blockbar,.whospost-toast');
 return {
  menuButton(){
   const c=[...doc.querySelectorAll('[role="button"][aria-haspopup="dialog"]')].filter(b=>!b.closest('[data-pressable-container]')&&!ours(b)&&b.querySelector('svg')&&visible(b));
   return c.length===1?c[0]:null;
  },
  blockItem(){
   const menus=[...doc.querySelectorAll('[role="menu"]')].filter(m=>visible(m)&&!ours(m));
   if(menus.length!==1)return null;
   const groups=new Map();
   for(const el of menus[0].querySelectorAll('[role="menuitem"]')){const g=groups.get(el.parentElement)??[];g.push({el,text:textOf(el)});groups.set(el.parentElement,g);}
   return pickBlockItem([...groups.values()]);
  },
  confirmButton(label,username){
   const name=String(username).toLowerCase();
   const dialogs=[...doc.querySelectorAll('[role="dialog"]')].filter(d=>visible(d)&&!ours(d)&&textOf(d).toLowerCase().includes(name));
   if(dialogs.length!==1)return null;
   const buttons=[...dialogs[0].querySelectorAll('[role="button"],button')].filter(b=>textOf(b)===label);
   return buttons.length===1?{el:buttons[0],dialog:dialogs[0]}:null;
  },
  closed:dialog=>!dialog.isConnected||!visible(dialog),
  click:el=>el.click()
 };
}
