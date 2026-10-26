// The popup (§3.4) reads chrome.storage directly instead of waking the service worker (KillSlop measured 394 ms
// against 2 ms). Settings are written back as one whole merged object, never a partial.
// Felix 10-26: status, a three-cell dashboard (已查詢 · 已分析 · 已封鎖), what is left this hour, checking an account;
// thresholds, the list and the API address fold away. No display-mode choice (always 只標籤), no feature switches
// (all on), no trust or blocked lists.
import {mergeSettings,validApiBase,apiBaseOf} from './lib/settings.mjs';
import {HOURLY_LIMIT as LIVE_LIMIT} from './lib/live.mjs';
import {checkUrl,LAYOUT_CHANGED} from './lib/label.mjs';
import {listStatus} from './lib/list.mjs';
import {accountFromInputLoose} from './lib/popup-input.mjs';
import {paused,HOURLY_LIMIT as PROFILE_LIMIT} from './lib/profile.mjs';
import {popupLine} from './lib/profile-label.mjs';
import {meter,meterText} from './lib/meter.mjs';
import {dashboardCells} from './lib/totals.mjs';
const $=id=>document.getElementById(id);
const fmt=t=>t?new Date(t).toLocaleString('zh-TW',{hour12:false,month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'';
let settings=mergeSettings(null);
async function load(){
 const [sync,local]=await Promise.all([chrome.storage.sync.get('settings'),chrome.storage.local.get(['list','pageStats','liveUsage','profiles','profileUsage','profileBreaker','profileFlag','totals'])]);
 settings=mergeSettings(sync.settings);
 draw(local);
 drawDashboard(local.totals);
}
function draw({list,pageStats,liveUsage,profiles,profileUsage,profileBreaker,profileFlag}){
 $('enabled').checked=settings.enabled;
 const health=pageStats?.health??'ok';
 $('light').dataset.state=!settings.enabled?'paused':health==='broken'?'broken':'ok';
 $('status').textContent=!settings.enabled?'已暫停':health==='broken'?LAYOUT_CHANGED:pageStats?.at&&Date.now()-pageStats.at<6*3600000?'運作中':'開啟 Threads 貼文頁後開始';
 paintMeter('live',meter(liveUsage,LIVE_LIMIT));
 drawProfile({profiles,profileUsage,profileBreaker,profileFlag});
 if(document.activeElement!==$('apiBase'))$('apiBase').value=settings.apiBase;
 $('apiBaseNote').textContent=settings.apiBase?`目前送到 ${apiBaseOf(settings)}（開發用）。頁面上的連結仍開正式站。`:'清單、回報與即時查都送到這裡；只接受 https，或本機的 http://localhost。';
 const status=listStatus(list),n=Array.isArray(list?.accounts)?list.accounts.length:0;
 $('list').textContent=status==='missing'?`清單暫時無法讀取${list?.failure?`（${list.failure}）`:''}`:`${n} 個帳號 · ${fmt(list.fetchedAt)}${status==='stale'?' · 上次更新失敗，用的是舊版':''}`;
}
// 已查詢 · 已分析 · 已封鎖: the first two counted by the background script, the last the local blocked list's size.
async function drawDashboard(totals){
 let blocked=null;
 try{const b=(await chrome.storage.local.get('blocked')).blocked;blocked=b&&typeof b==='object'?Object.keys(b).length:0;}catch{}
 for(const c of dashboardCells(totals,blocked))$(`d-${c.id}`).textContent=c.value==null?'—':c.value.toLocaleString('zh-TW');
}
// 帳號背景 (§4.4): the meter while it runs; switched off by the site or paused, one plain line instead.
function drawProfile({profiles,profileUsage,profileBreaker,profileFlag}){
 const remoteOn=profileFlag?.on!==false,isPaused=paused(profileBreaker);
 const off=!settings.profileLookup||!remoteOn||isPaused;
 paintMeter('profile',meter(profileUsage,PROFILE_LIMIT),{off:off&&popupLine({on:settings.profileLookup,remoteOn,breaker:profileBreaker,isPaused,cached:0})});
 if(!off)$('profileLine').textContent+=` · 已存 ${Object.keys(profiles??{}).length} 個帳號`;
}
// One usage meter (after Claude's usage page): used/limit on the right, a bar of what is used, one caption.
// off: the reason the feature is not running, shown in place of the caption; the bar goes grey.
function paintMeter(id,m,{off=false}={}){
 const box=$(`${id}Meter`),bar=$(`${id}Bar`),t=meterText(m);
 box.dataset.level=m.level;if(off)box.dataset.off='';else delete box.dataset.off;
 $(`${id}Right`).textContent=off?'暫停':t.right;
 bar.firstElementChild.style.width=`${m.pct}%`;bar.setAttribute('aria-valuemax',String(m.limit));bar.setAttribute('aria-valuenow',String(m.used));
 $(`${id}Line`).textContent=off||t.caption;
}
async function save(patch){
 settings=mergeSettings({...settings,...patch,thread:{...settings.thread,...(patch.thread??{})}});
 await chrome.storage.sync.set({settings});
}
$('enabled').addEventListener('change',e=>save({enabled:e.target.checked}));
$('apiBaseForm').addEventListener('submit',async e=>{e.preventDefault();const v=validApiBase($('apiBase').value.trim());if(v===null){$('apiBaseNote').textContent='只接受 https://… 或 http://localhost:…，不含路徑。';return;}await save({apiBase:v});chrome.runtime.sendMessage({type:'refreshList'},()=>{void chrome.runtime.lastError;load();});});
$('refresh').addEventListener('click',()=>{$('list').textContent='更新中…';chrome.runtime.sendMessage({type:'refreshList'},()=>{void chrome.runtime.lastError;load();});});
$('check').addEventListener('submit',e=>{e.preventDefault();const name=accountFromInputLoose($('username').value);if(!name){$('checkNote').textContent='看不懂這個帳號：只能是英數、底線、句點，最多 30 字，或貼 threads.com 的個人頁連結。';return;}$('checkNote').textContent='會開新分頁並預填帳號，查詢要你自己按。';chrome.tabs.create({url:checkUrl(name)});});
chrome.storage.onChanged.addListener(()=>load());
load();
