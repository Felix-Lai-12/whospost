// Wording for 帳號背景 (EXTENSION-SPEC §4.4): the one line beside the chip, the 「帳號背景」 section of the popover, the
// 新帳號 mark and the paused pill. Kept apart from label.mjs so the two features change separately. Pure strings.
import {NEW_ACCOUNT_DAYS} from './profile.mjs';
export const SECTION_TITLE='帳號背景';
export const SOURCE_NOTE='由 Threads 顯示，Whospost 不判定';
export const NEW_MARK='新帳號';
export const NEW_TITLE=`加入未滿 ${NEW_ACCOUNT_DAYS} 天。新帳號不等於假帳號。`;
export const PAUSED_TEXT='帳號背景暫停';
const pad=n=>String(n).padStart(2,'0');
/** "2026-09 加入 · 台灣": only what was read; an empty string when nothing was. No follower or following counts
 *  (Felix 10-24). */
export function backgroundLine(data){
 if(!data)return '';
 const parts=[];
 if(data.joined)parts.push(`${data.joined.year}-${pad(data.joined.month)} 加入`);
 if(data.country)parts.push(data.country);
 return parts.join(' · ');
}
// What the section says when there is no data for this author, by reason. Each says why, never "nothing".
const STATE_TEXT={
 loading:'讀取中…',
 queued:'等一下就會讀（每 2 秒最多讀一次）',
 failed:'這次沒讀到，之後會再試。',
 none:'Threads 找不到這個帳號的資料。',
 off:'已關閉。可在擴充套件的彈出視窗打開「讀取帳號背景」。',
 remoteOff:'Whospost 暫時關閉了這個功能。',
 paused:'帳號背景暫停：Threads 連續拒絕或版面變了，幾小時後自動再試。',
 signedOut:'登入 Threads 後才會顯示。',
 hourly:'這小時的讀取次數用完了，稍後再讀。'
};
/** The popover section: {title, rows:[[label, value]], status, note, newNote}. rows are only what was read. */
export function backgroundSection({state='loading',data=null,isNew=false,retryAt=''}={}){
 const rows=[];
 if(data){
  // Month only: Threads' text adds the sign-up ordinal ("· 1 億+"), which reads like a follower count.
  if(data.joined)rows.push(['加入',`${data.joined.year}年${data.joined.month}月`]);
  rows.push(['所在地點',data.country??(data.countryShared===false?'未分享':'沒有顯示')]);
  if(data.renames===null)rows.push(['改名','有改過，次數沒讀到']);
  else if(Number.isInteger(data.renames))rows.push(['改名',data.renames>0?`在 Threads 變更過 ${data.renames} 次`:'沒有']);
 }
 const status=data?'':state==='hourly'&&retryAt?`這小時的讀取次數用完了，${retryAt} 後再讀。`:(STATE_TEXT[state]??STATE_TEXT.loading);
 return {title:SECTION_TITLE,rows,status,note:SOURCE_NOTE,newNote:isNew?NEW_TITLE:''};
}
/** The popup's line for the switch. */
export function popupLine({on,remoteOn=true,breaker=null,cached=0,remaining=null,isPaused=false}){
 if(!on)return '已關閉：不讀取，已存的帳號背景也清掉了。';
 if(!remoteOn)return 'Whospost 暫時關閉了這個功能。';
 if(isPaused)return `${PAUSED_TEXT}：Threads 連續拒絕或版面變了（${breaker?.reason==='refused'?'被拒絕':'讀不懂'}），幾小時後自動再試；關掉再打開可以立刻重試。`;
 return `已存 ${cached} 個帳號（7 天內不重讀）${Number.isInteger(remaining)?`；這小時還可以讀 ${remaining} 次`:''}。只存在你的電腦。`;
}
