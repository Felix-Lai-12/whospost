(()=>{
 const ROOT='https://whospost.felixlai.workers.dev';let done=new WeakMap(),failures=0,settings={enabled:true,mode:'fade'},marks={};
 const link=(label,url)=>{const a=document.createElement('a');a.textContent=label;a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;};
 const button=(label,fn)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.addEventListener('click',fn);return b;};
 const digest=async s=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))].map(b=>b.toString(16).padStart(2,'0')).join('');
 async function process(node){
  const path=location.pathname.match(/^\/@([^/]+)\/post\/([^/]+)/);if(!path||!settings.enabled)return;
  const author=[...node.querySelectorAll('a[href^="/@"]')].find(a=>a.closest('[data-pressable-container]')===node)?.getAttribute('href')?.match(/^\/@([a-zA-Z0-9_.]{1,30})(?:\/|$)/)?.[1]?.toLowerCase();
  if(!author){if(++failures>=50){settings.enabled=false;chrome.storage.local.set({domBroken:true});}return;}
  failures=0;if(author===decodeURIComponent(path[1]).toLowerCase()||done.get(node)===author)return;
  node.querySelector(':scope > .whospost-card')?.remove();node.removeAttribute('data-whospost');done.set(node,author);
  const h=await digest(author),box=document.createElement('div'),why=document.createElement('details');node.dataset.whospostHash=h;box.className='whospost-card';box.addEventListener('click',e=>e.stopPropagation());
  const title=document.createElement('summary');title.textContent='Whospost · 為什麼';why.append(title);box.append(why);
  const show=()=>{node.removeAttribute('data-whospost');};
  const mark=button('這不是網軍 · 永久顯示',async()=>{show();marks[h]=true;await chrome.storage.local.set({marks});const result=await chrome.runtime.sendMessage({type:'appeal',h});mark.textContent=result?.ok?'已永久顯示並回報':'已永久顯示；回報未送達';});
  why.append(link('用 Whospost 查這個帳號',`${ROOT}/?u=${encodeURIComponent(author)}&from=ext`));
  try{
   const result=await chrome.runtime.sendMessage({type:'bucket',prefix:h.slice(0,4)}),entry=result?.rows?.find(a=>a.h===h);
   if(entry){
    title.textContent=`Whospost · ${entry.score??'未知'} 項線索 · 為什麼`;
    const p=document.createElement('p');p.textContent=`6 項檢查中 ${entry.assessed} 項可判、${entry.unknown} 項資料不足。`;why.append(p);
    const ul=document.createElement('ul');for(const hit of entry.hits??[]){const li=document.createElement('li');li.textContent=`${hit.label}：${hit.detail}`;ul.append(li);}why.append(ul);
    if(entry.ai?.summary){const p=document.createElement('p');p.textContent=`AI 判讀：${entry.ai.summary}`;why.append(p);}
    why.append(link('看完整證據',`${ROOT}/?scan=${encodeURIComponent(entry.scanId)}&from=ext`));
    if(!marks[h]&&entry.score>=3)node.dataset.whospost=settings.mode==='collapse'&&entry.score>=4?'collapse':'fade';
   }else if(result?.error){const p=document.createElement('p');p.textContent=result.error;why.append(p);}
  }catch{const p=document.createElement('p');p.textContent='清單暫時無法讀取';why.append(p);}
  const note=document.createElement('p');note.textContent='這不是身分判定。粉絲、客服、朋友也可能符合；0 項只代表本次資料沒看到。';
  why.append(note);box.append(button('顯示回覆',show),mark,link('申訴或要求刪除',`${ROOT}/privacy#deletion`));
  // A recycled or detached React node must never receive another account's result.
  if(!node.isConnected||done.get(node)!==author)return;node.append(box);
 }
 let queued=false;const scan=()=>{if(queued)return;queued=true;(globalThis.requestIdleCallback??setTimeout)(()=>{queued=false;document.querySelectorAll('[data-pressable-container]').forEach(n=>process(n));});};
 chrome.storage.local.get(['settings','marks']).then(data=>{settings={...settings,...data.settings};marks=data.marks??{};scan();new MutationObserver(scan).observe(document.body,{childList:true,subtree:true});});
 chrome.storage.onChanged.addListener(changes=>{if(changes.settings)settings={enabled:true,mode:'fade',...changes.settings.newValue};if(changes.marks){marks=changes.marks.newValue??{};document.querySelectorAll('[data-whospost-hash]').forEach(n=>{if(marks[n.dataset.whospostHash])n.removeAttribute('data-whospost');});}if(changes.settings){document.querySelectorAll('.whospost-card').forEach(n=>n.remove());document.querySelectorAll('[data-whospost]').forEach(n=>n.removeAttribute('data-whospost'));done=new WeakMap();scan();}});
})();
