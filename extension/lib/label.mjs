// Wording of the chip, the folded row, the "why" popover, the counter pill and the toasts
// (EXTENSION-UI-REDESIGN-20261023 §3, §5). Pure strings; the engine turns them into DOM.
// The six signal labels come from shared/signals.mjs itself, so the popover always names the rules the site uses.
import {signalScore} from './signals.mjs';
import {DEFAULT_SITE} from './settings.mjs';
export const SITE=DEFAULT_SITE;
export const checkUrl=username=>`${SITE}/?u=${encodeURIComponent(username)}&from=ext`;
export const scanUrl=scanId=>`${SITE}/?scan=${encodeURIComponent(scanId)}&from=ext`;
export const PRIVACY_DELETION_URL=`${SITE}/privacy#deletion`;
export const SIGNAL_LABELS=Object.freeze(Object.fromEntries(signalScore({}).items.map(i=>[i.id,i.label])));
export const SIGNAL_IDS=Object.freeze(Object.keys(SIGNAL_LABELS));
// Short names for chips and the folded row, where the full labels would not fit.
export const SIGNAL_SHORT=Object.freeze({'content-posts':'貼文內容重複','content-comments':'留言大量重複','author-focus':'半數以上給同一作者','thread-focus':'同篇超過 10 次','mutual-focus':'互相集中回覆','burst-replies':'10 秒內連留 3 次'});
export const THREAD_ONLY_NOTE='只看你眼前載入的回覆，不是查詢結果；捲動後數字會變。';
// 即時查 (§4.3): the hover control beside an unchecked account, the busy chip while it runs, the 快篩 marker.
export const LIVE_LABEL='即時查',LIVE_TITLE='用 Whospost 即時查這個帳號（會送出這個帳號名稱）',SCANNING_TEXT='查詢中…',QUICK_PREFIX='快篩';
export const QUICK_NOTE=({comments=0,posts=0}={})=>`快篩：只看了最近 ${posts} 篇貼文與 ${comments} 則留言，完整結果還在跑，好了會自動換上。`;
export const TOTAL=SIGNAL_IDS.length;
/** M/D in Taipei for an ISO timestamp, or '' when it does not parse. */
export function shortDate(iso){const t=Date.parse(iso??'');if(!Number.isFinite(t))return '';const d=new Date(t+8*3600000);return `${d.getUTCMonth()+1}/${d.getUTCDate()}`;}
const threadPhrases=thread=>(thread?.reasons??[]).map(r=>r.rule==='replies'?`本串 ${r.n} 則`:`${r.n} 個帳號貼同一段`);
const hitIds=entry=>(entry?.hits??[]).filter(id=>SIGNAL_SHORT[id]);
// A rule is named only two ways: its full label (SIGNAL_LABELS, from shared/signals.mjs) and its short name
// (SIGNAL_SHORT). No sentence of our own sums an account up (Felix 10-24: the one-line conclusions are gone).
/** A checked account's result in the chip's words: 「6 項中 N 項符合」, 「查過、沒線索」 at 0, 「查過、資料不足」 when
 *  nothing could be assessed. The chip and the popover title say the same thing. */
export function scoreText(entry){
 const n=Number.isInteger(entry?.score)?entry.score:null;
 return n===null?'查過、資料不足':n===0?'查過、沒線索':`${TOTAL} 項中 ${n} 項符合`;
}
/** The chip beside the name: {text, tone} with tone 'orange' (listed, at or above fadeAt), 'grey' (listed below it),
 *  'blue' (thread observation only), 'green' (trusted); null when there is nothing to show. */
export function chipText({entry=null,thread=null,trusted=false,fadeAt=3,live=null}){
 if(trusted)return {text:'已信任',tone:'green'};
 // A live result: the 快篩 pass is marked as such; a finished check with nothing to show still says it was checked.
 if(entry?.live){
  const n=Number.isInteger(entry.score)?entry.score:null,tone=n!==null&&n>=fadeAt?'orange':'grey';
  if(entry.partial)return {text:`${QUICK_PREFIX} ${n===null?'資料還不夠':`${TOTAL} 項中 ${n} 項符合`}`,tone,partial:true};
  return {text:scoreText(entry),tone};
 }
 if(live?.status==='scanning')return {text:SCANNING_TEXT,tone:'grey',busy:true};
 if(entry&&Number.isInteger(entry.score))return {text:scoreText(entry),tone:entry.score>=fadeAt?'orange':'grey'};
 const phrases=threadPhrases(thread);
 return phrases.length?{text:phrases[0],tone:'blue'}:null;
}
/** What goes beside the name (Felix 10-24): a checked account's reason chips in the tone its score chip had, and not
 *  the 「6 項中 N 項符合」 chip itself (folding still goes by the score); otherwise the status chip as it is: 已信任,
 *  查詢中…, 快篩…, 本串／同一段. {chip, reasons, tone}. A checked account with no hit shows nothing here. */
export function nameMarks({chip=null,entry=null}={}){
 if(!chip)return {chip:null,reasons:[],tone:null};
 const scored=(chip.tone==='orange'||chip.tone==='grey')&&!chip.busy&&!chip.partial;
 return scored?{chip:null,reasons:nameReasons({entry}),tone:chip.tone}:{chip,reasons:[],tone:chip.tone};
}
/** Every reason an account shows, for the folded row: the hits in rule order, then what the thread shows. */
export const reasonChips=({entry=null,thread=null})=>[...hitIds(entry).map(id=>SIGNAL_SHORT[id]),...threadPhrases(thread)];
/** The reason chips (Felix 10-24): the short names of a checked account's hits in rule order, beside the name and on
 *  the popover's title line. A trusted account shows none; a thread-only mark is its own chip already. */
export const nameReasons=({entry=null,trusted=false})=>trusted||!entry||!Number.isInteger(entry.score)?[]:hitIds(entry).map(id=>SIGNAL_SHORT[id]);
/** The popover (§3 item 4; Felix 10-24 on the 0.2 screenshots). The title: just 「@xx」 when the list carries an AI
 *  summary or reason chips (Felix 10-26; the summary right below, then who wrote it, e.g. 「Claude 自動撰寫」, and
 *  「AI 判斷，僅供參考」), else 「@xx · 」 and the chip's words (scoreText, e.g. 查過、沒線索), or the 快篩／本串 wording, which describe what was looked at rather than sum the account up; the
 *  reason chips on the title's line, to its right. Then one line about what is shown when it is not a checked result,
 *  and the actions. The check counts and date are on the evidence page; trusting moved out (folded row, popup); the
 *  appeal link lives on the evidence page. The block button (封鎖助手) is added by the engine, which knows the site's
 *  switch and the cooldown. No AI summary, no 「僅供參考」 line: the buttons follow at once. */
export const AI_NOTE='AI 判斷，僅供參考';
/** Who wrote the summary, from the list entry's ai.version (the scan's provenance.model): Gemini is the main provider,
 *  Claude the fallback (#68). A model the extension does not know, or none, says only 「AI 自動撰寫」, never a guess. */
export const aiSource=version=>/^gemini-/i.test(version??'')?'Gemini 自動撰寫':/^claude-/i.test(version??'')?'Claude 自動撰寫':'AI 自動撰寫';
export function popoverModel({username,entry=null,thread=null,live=null,liveAvailable=true}){
 const listed=!!entry&&(Number.isInteger(entry.score)||entry.live);
 let title,line=null;
 if(entry?.partial){
  title=`@${username} · ${Number.isInteger(entry.score)?`${QUICK_PREFIX} ${scoreText(entry)}`:'快篩中，資料還不夠'}`;
  line=QUICK_NOTE(live??{});
 }else if(listed){
  title=`@${username} · ${scoreText(entry)}`;
 }else{
  title=`@${username} · ${threadPhrases(thread)[0]??'本串觀察'}`;
  line=THREAD_ONLY_NOTE;
 }
 // Only an account the list has an AI summary for gets this part; without one it is left out, never shown as empty.
 const text=typeof entry?.ai?.summary==='string'?entry.ai.summary.trim():'';
 const ai=text?{text,source:aiSource(entry.ai.version)}:null;
 const chips=listed||entry?.partial?nameReasons({entry}):[];
 // Felix 10-26: with reason chips the title is the account alone, never 「6 項中 N 項符合」; the chips say it. A 快篩
 // result keeps the word 快篩 so it reads as not final (the line under it says so).
 if((ai||chips.length)&&!entry?.partial)title=`@${username}`;
 else if(chips.length&&entry?.partial)title=`@${username} · ${QUICK_PREFIX}`;
 // An unchecked account offers 即時查 (a button, §4.3) where a listed one offers its evidence; the site link stays below.
 const scanning=live?.status==='scanning';
 const secondary=listed&&entry.scanId&&!entry.partial?{label:'看完整證據',href:scanUrl(entry.scanId)}:listed&&!entry.live?{label:'用 Whospost 重新查詢',href:checkUrl(username)}:scanning?{action:'none',label:SCANNING_TEXT}:entry?.partial?{label:'看目前證據',href:scanUrl(entry.scanId)}:liveAvailable?{action:'live',label:LIVE_LABEL}:{label:'用 Whospost 查這個帳號',href:checkUrl(username)};
 const site=listed?null:{label:'到 Whospost 網站查',href:checkUrl(username)};
 return {title,chips,ai,line,note:ai?AI_NOTE:null,secondary,site};
}
/** The folded row: "已收起 N 則" and the two most common reasons across its members ({entry, thread} each). */
export function stubText(members){
 const count=new Map();
 for(const m of members)for(const r of reasonChips(m))count.set(r,(count.get(r)||0)+1);
 const reasons=[...count.entries()].sort((a,b)=>b[1]-a[1]).slice(0,2).map(([r])=>r);
 return {title:`已收起 ${members.length} 則`,reasons,text:reasons.join('、')};
}
/** The bottom-right pill: only when something is folded. */
export const pillText=collapsed=>collapsed>0?{title:`已收起 ${collapsed} 則`,action:'顯示全部'}:null;
export const LIST_UNREADABLE='清單暫時無法讀取';
export const LAYOUT_CHANGED='Threads 版面已變，等待更新';
/** Toasts after an action, each undoable for a few seconds. */
export function toastText(kind,{username,count=0,reason='',when=''}={}){
 switch(kind){
  case 'trust':return `已信任 @${username}，之後不再收起`;
  case 'untrust':return `已取消信任 @${username}`;
  case 'trustAll':return `已信任 ${count} 個帳號，之後不再收起`;
  case 'show':return `已顯示 ${count} 則`;
  case 'showAll':return `已顯示全部 ${count} 則`;
  case 'liveStarted':return `正在查 @${username}，你可以繼續往下滑`;
  case 'liveDone':return `@${username} 查好了`;
  case 'liveFailed':return `@${username} 查詢失敗${reason?`：${reason}`:''}`;
  case 'liveTimeout':return `@${username} 完整結果還沒好，先看快篩；之後會進清單`;
  case 'liveLimit':return `這小時的即時查用完了，${when?`${when} 後`:'稍後'}再試`;
  default:return '';
 }
}
/** The popup's one-line page summary. */
export function pageSummary(stats={}){
 const parts=[`已收起 ${stats.collapsed??0} 則`];
 if(stats.listed)parts.push(`查過 ${stats.listed} 個帳號`);
 if(stats.live)parts.push(`即時查 ${stats.live} 次`);
 if(stats.thread)parts.push(`本串觀察 ${stats.thread} 個帳號`);
 return parts.join(' · ');
}
export const STATUS_TEXT=Object.freeze({ok:'運作中',broken:LAYOUT_CHANGED,paused:'已暫停',idle:'開啟 Threads 貼文頁後開始'});
// 封鎖助手 (EXTENSION-SPEC §4.5): the popover button and its cooldown, the toast after a press, and the bar on the
// profile tab where the clicks happen. Kept together here so the 0.2 wording changes in one place.
export const BLOCK_NOTE='封鎖是你的決定，Whospost 只替你點，不判定任何人。';
/** The popover's primary button: 「封鎖 @xx」, or greyed with the seconds left while the cooldown runs. */
export const blockButtonText=({username,wait=0})=>wait>0?{label:`${wait} 秒後才能再封鎖`,disabled:true}:{label:`封鎖 @${username}`,disabled:false};
export const blockToastText=({username})=>`已開新分頁到 @${username} 的個人頁，Whospost 正替你點封鎖`;
export const LAYOUT_CHANGED_SELF='Threads 版面已變，請自己按';
/** The bar on the profile tab, one line per outcome; a stop names the step it stopped at (lib/block.mjs STEP_TEXT). */
export function blockBarText(kind,{username,reason=''}={}){
 switch(kind){
  case 'running':return `Whospost 正替你封鎖 @${username}：⋯ → 封鎖 → 確認`;
  case 'blocked':return `已封鎖 @${username}。Whospost 之後不再標它；要解除請到 Threads 的設定。`;
  case 'already':return `@${username} 之前就封鎖過了，Whospost 之後不再標它。`;
  case 'stopped':return `${LAYOUT_CHANGED_SELF}（停在：${reason}）。Whospost 沒有再點任何東西。`;
  case 'off':return 'Whospost 已暫停封鎖助手，沒有替你點任何東西。';
  default:return '';
 }
}
