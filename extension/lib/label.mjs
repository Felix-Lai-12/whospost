// Wording of the chip, the folded row, the "why" popover, the counter pill and the toasts
// (EXTENSION-UI-REDESIGN-20261023 §3, §5). Pure strings; the engine turns them into DOM.
// The six signal labels come from shared/signals.mjs itself, so the popover always names the rules the site uses.
import {signalScore} from './signals.mjs';
export const SITE='https://whospost.felixlai.workers.dev';
export const checkUrl=username=>`${SITE}/?u=${encodeURIComponent(username)}&from=ext`;
export const scanUrl=scanId=>`${SITE}/?scan=${encodeURIComponent(scanId)}&from=ext`;
export const PRIVACY_DELETION_URL=`${SITE}/privacy#deletion`;
export const SIGNAL_LABELS=Object.freeze(Object.fromEntries(signalScore({}).items.map(i=>[i.id,i.label])));
export const SIGNAL_IDS=Object.freeze(Object.keys(SIGNAL_LABELS));
// Short names for chips and the folded row, where the full labels would not fit.
export const SIGNAL_SHORT=Object.freeze({'content-posts':'貼文內容重複','content-comments':'留言大量重複','author-focus':'半數以上給同一作者','thread-focus':'同篇超過 10 次','mutual-focus':'互相集中回覆','burst-replies':'10 秒內連留 3 次'});
// One-line conclusions, strongest signal first: what a person would say after reading the hits.
const CONCLUSIONS=[['content-comments','留言像機器在發'],['burst-replies','在同一篇下連發留言'],['thread-focus','在同一篇下狂留言'],['content-posts','貼文一再重複'],['author-focus','集中回覆同一個人'],['mutual-focus','和另一個帳號互相集中回覆']];
export const NOT_IDENTITY='這不是身分判定；粉絲、客服、朋友互動都可能符合部分條件。';
export const THREAD_ONLY_NOTE='只看你眼前載入的回覆，不是查詢結果；捲動後數字會變。';
export const TOTAL=SIGNAL_IDS.length;
/** M/D in Taipei for an ISO timestamp, or '' when it does not parse. */
export function shortDate(iso){const t=Date.parse(iso??'');if(!Number.isFinite(t))return '';const d=new Date(t+8*3600000);return `${d.getUTCMonth()+1}/${d.getUTCDate()}`;}
const threadPhrases=thread=>(thread?.reasons??[]).map(r=>r.rule==='replies'?`本串 ${r.n} 則`:`${r.n} 個帳號貼同一段`);
const hitIds=entry=>(entry?.hits??[]).filter(id=>SIGNAL_SHORT[id]);
/** The one-sentence conclusion for a listed account: the strongest hit's sentence, or that nothing was seen. */
export function conclusion(entry){
 if(!entry||!Number.isInteger(entry.score))return '';
 const hits=new Set(hitIds(entry));
 for(const [id,text] of CONCLUSIONS)if(hits.has(id))return text;
 return '查過了，沒看到可疑行為';
}
/** The chip beside the name: {text, tone} with tone 'orange' (listed, at or above fadeAt), 'grey' (listed below it),
 *  'blue' (thread observation only), 'green' (trusted); null when there is nothing to show. */
export function chipText({entry=null,thread=null,trusted=false,fadeAt=3}){
 if(trusted)return {text:'已信任',tone:'green'};
 if(entry&&Number.isInteger(entry.score))return {text:`${TOTAL} 項中 ${entry.score} 項符合`,tone:entry.score>=fadeAt?'orange':'grey'};
 const phrases=threadPhrases(thread);
 return phrases.length?{text:phrases[0],tone:'blue'}:null;
}
/** The reason chips inside the popover: the hits in rule order, then what the thread shows. */
export const reasonChips=({entry=null,thread=null})=>[...hitIds(entry).map(id=>SIGNAL_SHORT[id]),...threadPhrases(thread)];
/** The popover (§3 item 4): a conclusion, reason chips, one line of numbers and date, the disclaimer, two buttons. */
export function popoverModel({username,entry=null,thread=null,trusted=false,listStatus='fresh',generated=null}){
 const listed=!!entry&&Number.isInteger(entry.score);
 const chips=reasonChips({entry,thread});
 let title,line;
 if(listed){
  const hits=hitIds(entry).length,no=Math.max(0,entry.assessed-hits);
  title=`@${username} · ${conclusion(entry)}`;
  const date=shortDate(entry.updated);
  line=`${TOTAL} 項檢查中 ${entry.score} 項符合、${no} 項不符合、${entry.unknown} 項資料不足。${date?`查於 ${date}。`:''}`;
  if(listStatus!=='fresh'&&generated)line+=`清單 ${shortDate(generated)} 版。`;
  if(entry.appeals>0)line+=`${entry.appeals} 人按過信任。`;
 }else{
  title=`@${username} · ${threadPhrases(thread)[0]??'本串觀察'}`;
  line=THREAD_ONLY_NOTE;
 }
 const primary=trusted?{action:'untrust',label:'取消信任'}:{action:'trust',label:'信任這個帳號'};
 const secondary=listed&&entry.scanId?{label:'看完整證據',href:scanUrl(entry.scanId)}:{label:listed?'用 Whospost 重新查詢':'用 Whospost 查這個帳號',href:checkUrl(username)};
 return {title,chips,line,note:NOT_IDENTITY,primary,secondary,deletion:{label:'申訴或要求刪除',href:PRIVACY_DELETION_URL}};
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
export function toastText(kind,{username,count=0}={}){
 switch(kind){
  case 'trust':return `已信任 @${username}，之後不再收起`;
  case 'untrust':return `已取消信任 @${username}`;
  case 'trustAll':return `已信任 ${count} 個帳號，之後不再收起`;
  case 'show':return `已顯示 ${count} 則`;
  case 'showAll':return `已顯示全部 ${count} 則`;
  default:return '';
 }
}
/** The popup's one-line page summary. */
export function pageSummary(stats={}){
 const parts=[`已收起 ${stats.collapsed??0} 則`];
 if(stats.listed)parts.push(`查過 ${stats.listed} 個帳號`);
 if(stats.thread)parts.push(`本串觀察 ${stats.thread} 個帳號`);
 return parts.join(' · ');
}
export const STATUS_TEXT=Object.freeze({ok:'運作中',broken:LAYOUT_CHANGED,paused:'已暫停',idle:'開啟 Threads 貼文頁後開始'});
