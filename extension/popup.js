// The popup (§3.4) reads chrome.storage directly instead of waking the service worker (KillSlop measured 394 ms
// against 2 ms). Settings are written back as one whole merged object, never a partial.
import {mergeSettings,effectiveMode,electionActive,ELECTION_WINDOW,validApiBase,apiBaseOf} from './lib/settings.mjs';
import {allowance,taipeiTime} from './lib/live.mjs';
import {pageSummary,checkUrl,LAYOUT_CHANGED} from './lib/label.mjs';
import {listStatus} from './lib/list.mjs';
import {accountFromInputLoose} from './lib/popup-input.mjs';
import {tallyText} from './lib/report.mjs';
import {slot,paused} from './lib/profile.mjs';
import {popupLine} from './lib/profile-label.mjs';
import {blockedListView,withoutBlocked} from './lib/block.mjs';
import {blockEnabled} from './lib/flags.mjs';
const $=id=>document.getElementById(id);
const fmt=t=>t?new Date(t).toLocaleString('zh-TW',{hour12:false,month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'';
let settings=mergeSettings(null);
// The trust list as last drawn, updated before each write and written in turn, so two quick 移除 presses both stick.
let trustedState={},trustedWrites=Promise.resolve();
async function load(){
 const [sync,local]=await Promise.all([chrome.storage.sync.get('settings'),chrome.storage.local.get(['list','trusted','pageStats','report','liveUsage','profiles','profileUsage','profileBreaker','profileFlag'])]);
 settings=mergeSettings(sync.settings);
 draw(local);
 drawBlocked();
}
function draw({list,trusted,pageStats,report,liveUsage,profiles,profileUsage,profileBreaker,profileFlag}){
 drawProfile({profiles,profileUsage,profileBreaker,profileFlag});
 $('enabled').checked=settings.enabled;
 for(const r of document.querySelectorAll('input[name="mode"]'))r.checked=r.value===settings.mode;
 $('fadeAt').value=settings.fadeAt;$('collapseAt').value=settings.collapseAt;
 $('threadEnabled').checked=settings.thread.enabled;$('threadBarAt').value=settings.thread.barAt;$('threadFadeAt').value=settings.thread.fadeAt;$('threadSameContentAt').value=settings.thread.sameContentAt;
 $('election').value=settings.election;$('showIcon').checked=settings.showIcon;
 const a=allowance(liveUsage);
 $('liveLine').textContent=a.remaining>0?`這小時還可以即時查 ${a.remaining} 次。`:`這小時的 ${a.limit} 次用完了，${taipeiTime(a.retryAt)} 後再試。`;
 if(document.activeElement!==$('apiBase'))$('apiBase').value=settings.apiBase;
 $('apiBaseNote').textContent=settings.apiBase?`目前送到 ${apiBaseOf(settings)}（開發用）。頁面上的連結仍開正式站。`:'清單、回報與即時查都送到這裡；只接受 https，或本機的 http://localhost。留空＝正式站。';
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
 trustedState=trusted&&typeof trusted==='object'?trusted:{};
 const entries=Object.entries(trustedState);
 if(!entries.length){const li=document.createElement('li');li.className='muted';li.textContent='還沒有';ul.append(li);}
 for(const [h,t] of entries.sort((a,b)=>(b[1]?.at??0)-(a[1]?.at??0))){
  const li=document.createElement('li');const name=document.createElement('span');name.textContent=`@${t?.username??h.slice(0,8)}`;
  const rm=document.createElement('button');rm.type='button';rm.textContent='移除';rm.addEventListener('click',()=>{const next={...trustedState};delete next[h];trustedState=next;trustedWrites=trustedWrites.then(()=>chrome.storage.local.set({trusted:next})).catch(()=>{});});
  li.append(name,rm);ul.append(li);
 }
}
// 帳號背景 (§4.4): the switch, and one line on what is kept and what is left this hour.
function drawProfile({profiles,profileUsage,profileBreaker,profileFlag}){
 $('profileLookup').checked=settings.profileLookup;
 $('profileLine').textContent=popupLine({on:settings.profileLookup,remoteOn:profileFlag?.on!==false,breaker:profileBreaker,isPaused:paused(profileBreaker),cached:Object.keys(profiles??{}).length,remaining:slot(profileUsage).remaining});
}
// 封鎖助手 (§4.5): the local blocked list in three states (reading / could not read / empty or the accounts), with 移除.
// Removing only lets Whospost mark the account again; it does not unblock it on Threads.
let blockedState={},blockedWrites=Promise.resolve();
function paintBlocked(view,flags){
 const ul=$('blocked');ul.textContent='';
 $('blockedCount').textContent=view.count==null?'':`${view.count} 個`;
 const note=$('blockedNote');note.hidden=blockEnabled(flags);note.textContent=flags?'Whospost 目前暫停封鎖助手：浮層不會出現封鎖按鈕。':'還沒向 Whospost 確認封鎖助手是否開放，浮層暫時不顯示封鎖按鈕。';
 if(view.state!=='list'){const li=document.createElement('li');li.className='muted';li.textContent={loading:'讀取中…',error:'讀不到已封鎖清單（本機儲存讀取失敗），請關掉這個視窗再開一次。',empty:'還沒有'}[view.state];ul.append(li);return;}
 for(const {h,username} of view.items){
  const li=document.createElement('li');const name=document.createElement('span');name.textContent=`@${username}`;
  const rm=document.createElement('button');rm.type='button';rm.textContent='移除';rm.addEventListener('click',()=>{const next=withoutBlocked(blockedState,h);blockedState=next;blockedWrites=blockedWrites.then(()=>chrome.storage.local.set({blocked:next})).catch(()=>{});});
  li.append(name,rm);ul.append(li);
 }
}
async function drawBlocked(){
 let r;
 try{r=await chrome.storage.local.get(['blocked','flags']);}catch{paintBlocked(blockedListView({status:'error'}),null);return;}
 blockedState=r.blocked&&typeof r.blocked==='object'?r.blocked:{};
 paintBlocked(blockedListView({status:'ok',blocked:r.blocked??{}}),r.flags??null);
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
$('apiBaseForm').addEventListener('submit',async e=>{e.preventDefault();const v=validApiBase($('apiBase').value.trim());if(v===null){$('apiBaseNote').textContent='只接受 https://… 或 http://localhost:…，不含路徑。';return;}await save({apiBase:v});chrome.runtime.sendMessage({type:'refreshList'},()=>{void chrome.runtime.lastError;load();});});
$('report').addEventListener('change',async e=>{await save({report:e.target.checked});if(!e.target.checked)await chrome.storage.local.remove('report');});
// Off clears what was kept; on again starts clean (the stop rule too).
$('profileLookup').addEventListener('change',async e=>{await save({profileLookup:e.target.checked});await chrome.storage.local.remove(e.target.checked?['profileBreaker']:['profiles','profileBreaker']);});
$('refresh').addEventListener('click',()=>{$('list').textContent='更新中…';chrome.runtime.sendMessage({type:'refreshList'},()=>{void chrome.runtime.lastError;load();});});
$('check').addEventListener('submit',e=>{e.preventDefault();const name=accountFromInputLoose($('username').value);if(!name){$('checkNote').textContent='看不懂這個帳號：只能是英數、底線、句點，最多 30 字，或貼 threads.com 的個人頁連結。';return;}$('checkNote').textContent='會開新分頁並預填帳號，查詢要你自己按。';chrome.tabs.create({url:checkUrl(name)});});
chrome.storage.onChanged.addListener(()=>load());
load();
