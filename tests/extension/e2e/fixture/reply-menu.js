// Appended to fixture/post.html by run.mjs: each reply's 「⋯」 (its [role="button"][aria-haspopup="menu"]) opens a menu
// shaped like the one measured 2026-10-26 on a logged-in threads.com post (four groups, the last Mute · Restrict ·
// Block · Report). Block opens "Block <user>?" with Block and Cancel; Report opens Threads' "Why are you reporting
// this?" window, where nothing is ever pressed. user04's menu has no Block (the layout changed).
// window.__presses records what was pressed, for the assertions.
(()=>{
 const presses=window.__presses=[];
 const h=(tag,attrs,...kids)=>{const n=document.createElement(tag);for(const [k,v] of Object.entries(attrs||{}))n.setAttribute(k,v);n.append(...kids);return n;};
 const style=h('style',{},`
  .fx-menu{position:fixed;top:120px;left:420px;z-index:10;width:220px;background:#fff;border:1px solid #ddd;border-radius:14px;padding:6px 0;font:14px system-ui}
  .fx-menu>div+div{border-top:1px solid #eee}
  .fx-menu [role=menuitem]{display:block;padding:10px 14px;cursor:pointer}
  .fx-scrim{position:fixed;inset:0;z-index:11;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center}
  .fx-scrim [role=dialog]{width:300px;background:#fff;border-radius:16px;padding:20px;font:14px system-ui}
  .fx-scrim [role=button]{display:block;padding:10px;margin-top:8px;text-align:center;border:1px solid #ddd;border-radius:10px;cursor:pointer}`);
 document.head.append(style);
 const item=text=>h('div',{role:'menuitem',tabindex:'0'},h('span',{},text));
 const authorOf=row=>{const a=[...row.querySelectorAll('a[href^="/@"]')].find(x=>x.closest('[data-pressable-container]')===row&&/^\/@[^/]+\/?$/.test(x.getAttribute('href')));return a?a.getAttribute('href').replace(/^\/@/,'').replace(/\/$/,''):'';};
 // The main post's container also holds the replies' sort control ("Top", a menu button with text); user03's row
 // gets one too, so the block run has to tell it from the ⋯ (Felix 10-27, the post author's 封鎖 in Dia).
 const row03=[...document.querySelectorAll('div[data-pressable-container="true"]')].find(r=>authorOf(r)==='user03');
 if(row03){const sort=h('div',{role:'button','aria-haspopup':'menu',tabindex:'0'},'Top');sort.addEventListener('click',()=>presses.push('sort'));row03.append(sort);}
 let menu=null;
 const close=()=>{menu?.remove();menu=null;};
 window.__closeMenu=close;
 document.addEventListener('click',e=>{
  const more=e.target.closest?.('[role="button"][aria-haspopup="menu"]');
  const row=more?.closest('[data-pressable-container]');
  if(!more||!row||more.closest('[data-pressable-container]')!==row)return;
  e.preventDefault();e.stopPropagation();
  const user=authorOf(row);
  presses.push(`more:${user}`);
  if(menu){close();return;}
  const last=[item('Mute'),item('Restrict')];if(user!=='user04')last.push(item('Block'));last.push(item('Report'));
  const groups=[h('div',{},item('Copy link'),item('Get embed code')),h('div',{},item('Save'),item('Not interested')),h('div',{},item('Add to feed')),h('div',{},...last)];
  // Like Threads, the menu shows up a moment after the press.
  setTimeout(()=>{
   menu=h('div',{role:'menu',class:'fx-menu'},...groups);document.body.append(menu);
   menu.addEventListener('click',ev=>{const it=ev.target.closest('[role=menuitem]');if(!it)return;presses.push(`menu:${it.textContent}`);close();
    if(it.textContent==='Block')setTimeout(()=>confirmDialog(user),200);
    if(it.textContent==='Report')setTimeout(reportDialog,200);});
  },150);
 },true);
 function confirmDialog(user){
  const block=h('div',{role:'button',tabindex:'0'},'Block'),cancel=h('div',{role:'button',tabindex:'0'},'Cancel');
  const scrim=h('div',{class:'fx-scrim'},h('div',{role:'dialog'},h('b',{},`Block ${user}?`),h('p',{},`${user} won't be able to find your profile or content.`),block,cancel));
  document.body.append(scrim);
  block.addEventListener('click',()=>{presses.push('confirm:Block');setTimeout(()=>scrim.remove(),300);});
  cancel.addEventListener('click',()=>{presses.push('confirm:Cancel');scrim.remove();});
 }
 function reportDialog(){
  const reasons=['I just don\'t like it','Bullying or unwanted contact','Scam, fraud or spam','False information'].map(t=>{const b=h('div',{role:'button',tabindex:'0'},t);b.addEventListener('click',()=>presses.push(`report:${t}`));return b;});
  const closeBtn=h('div',{role:'button',tabindex:'0','aria-label':'Close'},'×');
  const scrim=h('div',{class:'fx-scrim fx-report'},h('div',{role:'dialog'},h('b',{},'Report'),h('p',{},'Why are you reporting this?'),...reasons,closeBtn));
  document.body.append(scrim);
  closeBtn.addEventListener('click',()=>{presses.push('report:close');scrim.remove();});
 }
})();
