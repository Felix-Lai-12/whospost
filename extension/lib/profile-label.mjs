// Wording for 帳號背景 (EXTENSION-SPEC §4.4): the 「帳號背景」 section of the popover, the 新帳號 mark and the paused
// pill. Beside the name: the place as a flag (lib/country-flag.mjs), then how long ago the account joined (Felix 10-26;
// the month itself stays in the popover). Kept apart from label.mjs so the two features change separately. Pure strings.
import {NEW_ACCOUNT_DAYS} from './profile.mjs';
export const SECTION_TITLE='帳號背景';
export const NEW_TITLE=`加入未滿 ${NEW_ACCOUNT_DAYS} 天。新帳號不等於假帳號。`;
export const PAUSED_TEXT='帳號背景暫停';
const pad=n=>String(n).padStart(2,'0');
/** How long ago the account joined, beside the flag (Felix 10-26). Threads gives the month only, so this month reads
 *  「近 1 個月加入」, then 「N 個月前加入」, then 「N 年前加入」; a week cannot be told. null without a month. */
export function joinedAgo(joined,now=Date.now()){
 if(!Number.isInteger(joined?.year)||!Number.isInteger(joined?.month))return null;
 const t=new Date(now+8*3600000),months=(t.getUTCFullYear()-joined.year)*12+(t.getUTCMonth()+1-joined.month);
 if(months<0)return null;
 return months===0?'近 1 個月加入':months<12?`${months} 個月前加入`:`${Math.floor(months/12)} 年前加入`;
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
/** The popover section: {title, rows:[[label, value]], status, newNote}. rows are only what was read. */
export function backgroundSection({state='loading',data=null,isNew=false,retryAt=''}={}){
 const rows=[];
 if(data){
  // Month only: Threads' text adds the sign-up ordinal ("· 1 億+"), which reads like a follower count.
  if(data.joined)rows.push(['加入',`${data.joined.year}年${data.joined.month}月`]);
  rows.push(['所在地點',data.country??(data.countryShared===false?'未分享':'沒有顯示')]);
  // 改名 is still read and cached (data.renames) but not shown for now (Felix 10-24).
 }
 // From the list (Felix 10-27): another user read it after pressing 「AI 打詐」; said so, with how many places agreed.
 if(data?.shared)return {title:SECTION_TITLE,rows,status:`其他使用者讀到的${Number.isInteger(data.reports)&&data.reports>1?`（${data.reports} 個網路位置回報）`:''}，你這邊沒有另外讀。`,newNote:isNew?NEW_TITLE:''};
 const status=data?'':state==='hourly'&&retryAt?`這小時的讀取次數用完了，${retryAt} 後再讀。`:(STATE_TEXT[state]??STATE_TEXT.loading);
 return {title:SECTION_TITLE,rows,status,newNote:isNew?NEW_TITLE:''};
}
/** The popup's line for the switch. */
export function popupLine({on,remoteOn=true,breaker=null,cached=0,remaining=null,isPaused=false}){
 if(!on)return '已關閉：不讀取，已存的帳號背景也清掉了。';
 if(!remoteOn)return 'Whospost 暫時關閉了這個功能。';
 if(isPaused)return `${PAUSED_TEXT}：Threads 連續拒絕或版面變了（${breaker?.reason==='refused'?'被拒絕':'讀不懂'}），幾小時後自動再試；關掉再打開可以立刻重試。`;
 return `已存 ${cached} 個帳號（7 天內不重讀）${Number.isInteger(remaining)?`；這小時還可以讀 ${remaining} 次`:''}。按過 AI 打詐的帳號，國家與加入月份會送到 Whospost 公開；其他只存在你的電腦。`;
}
