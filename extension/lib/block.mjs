// 封鎖助手 and 檢舉 (EXTENSION-SPEC §4.5, §10.3 #21), after davidberger1210/threads-report-block (MIT). The user presses
// 「封鎖 @xx」 or 「檢舉 @xx」 in the popover and the extension opens that reply's own 「⋯」 menu, right where it is (Felix
// 10-26: no new tab to the profile any more). Block: 「⋯ → 封鎖 → 確認」, then a toast. Report: 「⋯ → 檢舉」 opens Threads'
// own report window and stops there; the reason is the user's to pick and send. One account per press, 8 seconds between
// blocks, no batch, no built-in list. Each step looks for its element by structure; when it is not there (or there is
// more than one), the run stops where it is and says so: no guessing, no retry, no fallback to text search across the page.
// Pure helpers first (cooldown, the local blocked list), then the step runners, which take the page through a small
// adapter so the order and the stop-on-miss rule are tested without a browser, and last the adapter for a reply on a
// post page (measured 2026-10-26 in a logged-in Chrome, English UI, on a /@zuck post):
//   ⋯       the reply's only [role="button"][aria-haspopup="menu"] (its svg's <title> is "More"; Repost beside it says
//           aria-haspopup="dialog"), inside the reply's own data-pressable-container
//   menu    one [role="menu"]; its [role="menuitem"]s come in four groups (one parent each): Copy link · Get embed code /
//           Save · Not interested / Add to feed / Mute · Restrict · Block · Report. Block and Report are in the last group.
//   confirm a [role="dialog"] titled "Block zuck?" holding two [role="button"]s, Block and Cancel; Block shares the menu
//           item's label, which is how it is told apart without a word list of its own.
//   report  a [role="dialog"] "Report — Why are you reporting this?" listing Threads' reasons; Whospost presses none.
// The profile page's menu (measured 10-24) has the same last group, so a block there reports Unblock as 'already'.
export const BLOCK_COOLDOWN_MS=8000;
// The menu item's own label, per language actually seen (en measured 10-24; zh-TW from threads-report-block, which
// matches 「封鎖」 and 「解除封鎖」). Any other label stops the run: the item in that place is not known to be Block.
export const BLOCK_LABELS=Object.freeze(['Block','封鎖']);
export const UNBLOCK_LABELS=Object.freeze(['Unblock','解除封鎖']);
export const REPORT_LABELS=Object.freeze(['Report','檢舉']);
export const STEPS=Object.freeze(['menuButton','blockItem','confirmButton','confirmClosed']);
export const REPORT_STEPS=Object.freeze(['menuButton','reportItem','reportDialog']);
export const STEP_TEXT=Object.freeze({menuButton:'找不到這則回覆的「⋯」按鈕',blockItem:'「⋯」選單裡找不到「封鎖」',confirmButton:'找不到封鎖的確認視窗',confirmClosed:'按了確認，但確認視窗沒有關上',reportItem:'「⋯」選單裡找不到「檢舉」',reportDialog:'找不到 Threads 的檢舉視窗'});
// How long each step waits for its element to appear (menus and dialogs animate in).
export const STEP_TIMEOUT_MS=Object.freeze({menuButton:3000,blockItem:3000,confirmButton:3000,confirmClosed:5000,reportItem:3000,reportDialog:4000});
const USERNAME=/^[a-z0-9_.]{1,30}$/;
/** Whole seconds left before the next press is allowed (0 = now). */
export const cooldownLeft=(until,now=Date.now())=>Number.isFinite(until)&&until>now?Math.ceil((until-now)/1000):0;
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
/** 'block', 'unblock', 'report' or null for a menu item's label. */
export function classifyMenuItem(text){
 const t=String(text??'').trim();
 return BLOCK_LABELS.includes(t)?'block':UNBLOCK_LABELS.includes(t)?'unblock':REPORT_LABELS.includes(t)?'report':null;
}
// Groups of {el, text} in page order → the one item of the last group whose label is one of `kinds`, else null (none,
// two, or only somewhere else in the menu: not guessed).
const pickIn=(groups,kinds)=>{
 const last=Array.isArray(groups)?groups.at(-1):null;
 const found=(Array.isArray(last)?last:[]).map(item=>({item,kind:classifyMenuItem(item.text)})).filter(x=>kinds.includes(x.kind));
 return found.length===1?{kind:found[0].kind,label:found[0].item.text.trim(),el:found[0].item.el}:null;
};
/** Block (or Unblock) in the menu's last group. */
export const pickBlockItem=groups=>pickIn(groups,['block','unblock']);
/** Report in the menu's last group. */
export const pickReportItem=groups=>pickIn(groups,['report']);
/** Runs the block steps through `dom` (see threadsReplyDom). Each step waits up to its timeout for its element, clicks it
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
/** Opens Threads' report window for the reply through `dom`: ⋯ → 檢舉, then waits for the window and stops. Nothing in
 *  it is pressed; the user picks the reason. @returns {Promise<{ok:true,status:'opened'}|{ok:false,step,index,reason}>} */
export async function runReport({dom,sleep=ms=>new Promise(r=>setTimeout(r,ms)),now=Date.now,interval=150,timeouts=STEP_TIMEOUT_MS}){
 const waitFor=async(fn,ms)=>{const end=now()+ms;for(;;){const v=fn();if(v)return v;if(now()>=end)return null;await sleep(interval);}};
 const stop=step=>({ok:false,step,index:REPORT_STEPS.indexOf(step)+1,reason:STEP_TEXT[step]});
 const button=await waitFor(()=>dom.menuButton(),timeouts.menuButton);
 if(!button)return stop('menuButton');
 dom.click(button);
 const item=await waitFor(()=>dom.reportItem(),timeouts.reportItem);
 if(!item)return stop('reportItem');
 dom.click(item.el);
 return await waitFor(()=>dom.reportDialog(),timeouts.reportDialog)?{ok:true,status:'opened'}:stop('reportDialog');
}
const visible=el=>{const r=el.getBoundingClientRect?.();return !!r&&r.width>0&&r.height>0;};
const textOf=el=>String(el.innerText??el.textContent??'').trim();
/** The adapter for one reply (`row`, its data-pressable-container) on a post page; measurements in the header comment.
 *  Every finder returns null unless exactly one element fits, so two candidates stop the run the same way none does. */
export function threadsReplyDom(row,doc){
 const ours=el=>!!el.closest('.whospost-pop,.whospost-toast');
 const groups=()=>{
  const menus=[...doc.querySelectorAll('[role="menu"]')].filter(m=>visible(m)&&!ours(m));
  if(menus.length!==1)return null;
  const g=new Map();
  for(const el of menus[0].querySelectorAll('[role="menuitem"]')){const list=g.get(el.parentElement)??[];list.push({el,text:textOf(el)});g.set(el.parentElement,list);}
  return [...g.values()];
 };
 const dialogs=()=>[...doc.querySelectorAll('[role="dialog"]')].filter(d=>visible(d)&&!ours(d)&&textOf(d));
 return {
  menuButton(){
   if(!row?.isConnected)return null;
   const c=[...row.querySelectorAll('[role="button"][aria-haspopup="menu"]')].filter(b=>b.closest('[data-pressable-container]')===row&&!ours(b)&&visible(b));
   return c.length===1?c[0]:null;
  },
  blockItem:()=>pickBlockItem(groups()),
  reportItem:()=>pickReportItem(groups()),
  confirmButton(label,username){
   const name=String(username).toLowerCase();
   const d=dialogs().filter(x=>textOf(x).toLowerCase().includes(name));
   if(d.length!==1)return null;
   const buttons=[...d[0].querySelectorAll('[role="button"],button')].filter(b=>textOf(b)===label);
   return buttons.length===1?{el:buttons[0],dialog:d[0]}:null;
  },
  closed:dialog=>!dialog.isConnected||!visible(dialog),
  // The report window: exactly one dialog with something in it (Threads also keeps an empty one around).
  reportDialog(){const d=dialogs();return d.length===1?d[0]:null;},
  click:el=>el.click()
 };
}
