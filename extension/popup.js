// The popup (§3.4) reads chrome.storage directly instead of waking the service worker (KillSlop measured 394 ms
// against 2 ms). Settings are written back as one whole merged object, never a partial.
// Felix 10-26: status, the site-wide list size, a three-cell dashboard (AI 打詐 · 查詢背景 · 封鎖, counts of times, Felix 10-27), what is left this
// hour, the footer links. No settings, no account box (即時查 sits beside every unchecked name), no display-mode
// choice (always 只標籤), no feature switches (all on), no trust or blocked lists.
import {mergeSettings} from './lib/settings.mjs';
import {HOURLY_LIMIT as LIVE_LIMIT} from './lib/live.mjs';
import {LAYOUT_CHANGED} from './lib/label.mjs';
import {listStatus} from './lib/list.mjs';
import {paused,HOURLY_LIMIT as PROFILE_LIMIT} from './lib/profile.mjs';
import {popupLine} from './lib/profile-label.mjs';
import {meter,meterText} from './lib/meter.mjs';
import {dashboardCells} from './lib/totals.mjs';
const $=id=>document.getElementById(id);
let settings=mergeSettings(null);
async function load(){
 const [sync,local]=await Promise.all([chrome.storage.sync.get('settings'),chrome.storage.local.get(['list','pageStats','liveUsage','profiles','profileUsage','profileBreaker','profileFlag','totals'])]);
 settings=mergeSettings(sync.settings);
 draw(local);
 drawDashboard(local.totals);
}
function draw({list,pageStats,liveUsage,profiles,profileUsage,profileBreaker,profileFlag}){
 $('enabled').checked=settings.enabled;
 $('replies').checked=settings.replies;
 const health=pageStats?.health??'ok';
 $('light').dataset.state=!settings.enabled?'paused':health==='broken'?'broken':'ok';
 $('status').textContent=!settings.enabled?'已暫停':health==='broken'?LAYOUT_CHANGED:pageStats?.at&&Date.now()-pageStats.at<6*3600000?'運作中':'開啟 Threads 貼文頁後開始';
 paintMeter('live',meter(liveUsage,LIVE_LIMIT));
 drawProfile({profiles,profileUsage,profileBreaker,profileFlag});
 const status=listStatus(list),n=Array.isArray(list?.accounts)?list.accounts.length:0;
 // The site-wide list (Felix 10-26): how many accounts Whospost has analysed.
 $('list').replaceChildren(status==='missing'?'全站清單暫時讀不到':`全站累積 ${n.toLocaleString('zh-TW')} 帳號分析`);
 if(status==='stale')$('list').append(' · 這次更新失敗，用的是上一份');
}
// AI 打詐 · 查詢背景 · 封鎖 (Felix 10-27): the first two counted by the background script, 封鎖 the local blocked list's size.
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
$('replies').addEventListener('change',e=>save({replies:e.target.checked}));
chrome.storage.onChanged.addListener(()=>load());
load();
