// The popup (§3.4) reads chrome.storage directly instead of waking the service worker (KillSlop measured 394 ms
// against 2 ms). Settings are written back as one whole merged object, never a partial.
import {mergeSettings,effectiveMode,electionActive,ELECTION_WINDOW} from './lib/settings.mjs';
import {pageSummary,checkUrl,LAYOUT_CHANGED} from './lib/label.mjs';
import {listStatus} from './lib/list.mjs';
import {accountFromInputLoose} from './lib/popup-input.mjs';
import {tallyText} from './lib/report.mjs';
const $=id=>document.getElementById(id);
const fmt=t=>t?new Date(t).toLocaleString('zh-TW',{hour12:false,month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'';
let settings=mergeSettings(null);
async function load(){
 const [sync,local]=await Promise.all([chrome.storage.sync.get('settings'),chrome.storage.local.get(['list','trusted','pageStats','report'])]);
 settings=mergeSettings(sync.settings);
 draw(local);
}
function draw({list,trusted,pageStats,report}){
 $('enabled').checked=settings.enabled;
 for(const r of document.querySelectorAll('input[name="mode"]'))r.checked=r.value===settings.mode;
 $('fadeAt').value=settings.fadeAt;$('collapseAt').value=settings.collapseAt;
 $('threadEnabled').checked=settings.thread.enabled;$('threadBarAt').value=settings.thread.barAt;$('threadFadeAt').value=settings.thread.fadeAt;$('threadSameContentAt').value=settings.thread.sameContentAt;
 $('election').value=settings.election;$('showIcon').checked=settings.showIcon;
 $('report').checked=settings.report;$('reportLine').textContent=settings.report?tallyText(report):'已關閉：不累計、不送出。';
 const mode=effectiveMode(settings);
 $('electionNote').textContent=electionActive(settings)?`選舉模式生效中：只在名字旁放晶片，不收起、不變淡。（${ELECTION_WINDOW.from.slice(5).replace('-','/')}–${ELECTION_WINDOW.to.slice(5).replace('-','/')} 自動開）`:`選舉期間（${ELECTION_WINDOW.from.slice(5).replace('-','/')}–${ELECTION_WINDOW.to.slice(5).replace('-','/')}）自動降成只標籤。目前顯示方式：${{label:'只標籤',fade:'只變淡',collapse:'預設收起'}[mode]}`;
 const status=listStatus(list);
 const health=pageStats?.health??'ok';
 const state=!settings.enabled?'paused':health==='broken'?'broken':'ok';
 $('light').dataset.state=state;
 $('status').textContent=!settings.enabled?'已暫停':health==='broken'?LAYOUT_CHANGED:pageStats?.at&&Date.now()-pageStats.at<6*3600000?'運作中':'開啟 Threads 貼文頁後開始';
 $('stats').textContent=pageStats?.at?pageSummary(pageStats):'尚未在 Threads 貼文頁掃描';
 const n=Array.isArray(list?.accounts)?list.accounts.length:0;
 $('list').textContent=status==='missing'?`清單暫時無法讀取${list?.failure?`（${list.failure}）`:''}；目前只靠本串觀察與你的信任標記。`:`${n} 個帳號 · 更新於 ${fmt(list.fetchedAt)}${status==='stale'?` · 最近一次更新失敗${list?.failure?`（${list.failure}）`:''}，用的是舊版`:''}`;
 const ul=$('trusted');ul.textContent='';
 const entries=Object.entries(trusted??{});
 if(!entries.length){const li=document.createElement('li');li.className='muted';li.textContent='還沒有';ul.append(li);}
 for(const [h,t] of entries.sort((a,b)=>(b[1]?.at??0)-(a[1]?.at??0))){
  const li=document.createElement('li');const name=document.createElement('span');name.textContent=`@${t?.username??h.slice(0,8)}`;
  const rm=document.createElement('button');rm.type='button';rm.textContent='移除';rm.addEventListener('click',async()=>{const next={...trusted};delete next[h];await chrome.storage.local.set({trusted:next});});
  li.append(name,rm);ul.append(li);
 }
}
async function save(patch){
 settings=mergeSettings({...settings,...patch,thread:{...settings.thread,...(patch.thread??{})}});
 await chrome.storage.sync.set({settings});
}
$('enabled').addEventListener('change',e=>save({enabled:e.target.checked}));
for(const r of document.querySelectorAll('input[name="mode"]'))r.addEventListener('change',e=>{if(e.target.checked)save({mode:e.target.value});});
$('fadeAt').addEventListener('change',e=>save({fadeAt:Number(e.target.value)}));
$('collapseAt').addEventListener('change',e=>save({collapseAt:Number(e.target.value)}));
$('threadEnabled').addEventListener('change',e=>save({thread:{enabled:e.target.checked}}));
$('threadBarAt').addEventListener('change',e=>save({thread:{barAt:Number(e.target.value)}}));
$('threadFadeAt').addEventListener('change',e=>save({thread:{fadeAt:Number(e.target.value)}}));
$('threadSameContentAt').addEventListener('change',e=>save({thread:{sameContentAt:Number(e.target.value)}}));
$('election').addEventListener('change',e=>save({election:e.target.value}));
$('showIcon').addEventListener('change',e=>save({showIcon:e.target.checked}));
$('report').addEventListener('change',async e=>{await save({report:e.target.checked});if(!e.target.checked)await chrome.storage.local.remove('report');});
$('refresh').addEventListener('click',()=>{$('list').textContent='更新中…';chrome.runtime.sendMessage({type:'refreshList'},()=>{void chrome.runtime.lastError;load();});});
$('check').addEventListener('submit',e=>{e.preventDefault();const name=accountFromInputLoose($('username').value);if(!name)return;chrome.tabs.create({url:checkUrl(name)});});
chrome.storage.onChanged.addListener(()=>load());
load();
