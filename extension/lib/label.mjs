// Wording of the bar, the "why" card and the counter (§3.1, §3.3). Pure strings; the engine turns them into DOM.
// The six signal labels come from shared/signals.mjs itself, so the card always names the rules the site uses.
import {signalScore} from './signals.mjs';
export const SITE='https://whospost.felixlai.workers.dev';
export const checkUrl=username=>`${SITE}/?u=${encodeURIComponent(username)}&from=ext`;
export const scanUrl=scanId=>`${SITE}/?scan=${encodeURIComponent(scanId)}&from=ext`;
export const PRIVACY_DELETION_URL=`${SITE}/privacy#deletion`;
export const SIGNAL_LABELS=Object.freeze(Object.fromEntries(signalScore({}).items.map(i=>[i.id,i.label])));
export const SIGNAL_IDS=Object.freeze(Object.keys(SIGNAL_LABELS));
// Short names for the bar, where the full labels would not fit on one line.
export const SIGNAL_SHORT=Object.freeze({'content-posts':'貼文內容重複','content-comments':'留言大量重複','author-focus':'集中回覆同一作者','thread-focus':'同篇留言超過 10 次','mutual-focus':'互相集中回覆','burst-replies':'10 秒內連續留言'});
export const NOT_IDENTITY='這不是身分判定。分數是未校準的規則檢查，粉絲、客服、朋友互動都可能符合部分條件；0 項也不代表正常，只代表這次資料裡沒看到。';
export const THREAD_ONLY_NOTE='只看你眼前載入的回覆，不是查詢結果；捲動後數字會變。';
export const TOTAL=SIGNAL_IDS.length;
/** M/D in Taipei for an ISO timestamp, or '' when it does not parse. */
export function shortDate(iso){const t=Date.parse(iso??'');if(!Number.isFinite(t))return '';const d=new Date(t+8*3600000);return `${d.getUTCMonth()+1}/${d.getUTCDate()}`;}
const threadPhrases=thread=>(thread?.reasons??[]).map(r=>r.rule==='replies'?`這個帳號在這串留了 ${r.n} 則`:`另有 ${r.n-1} 個帳號貼了相同內容`);
/** The bar: {source, text, tone} where tone is 'orange' (a listed account at or above fadeAt), 'blue' (listed below
 *  it, or thread observation only). Order is fixed: source · summary · up to two hit signals · date — thread part. */
export function barText({entry=null,thread=null,listStatus='fresh',generated=null,fadeAt=3}){
 const threadParts=threadPhrases(thread);
 if(entry&&Number.isInteger(entry.score)){
  const hits=(entry.hits??[]).filter(id=>SIGNAL_SHORT[id]).slice(0,2).map(id=>SIGNAL_SHORT[id]);
  const parts=['Whospost',`${TOTAL} 項中 ${entry.score} 項符合`,...hits];
  const date=shortDate(entry.updated);
  let text=parts.join(' · ')+(date?` — 查於 ${date}`:'');
  if(threadParts.length)text+=` — 本串：${threadParts.join('、')}`;
  if(listStatus!=='fresh'&&generated)text+=` · 清單 ${shortDate(generated)} 版`;
  return {source:'Whospost',text,tone:entry.score>=fadeAt?'orange':'blue'};
 }
 return {source:'本串觀察',text:['本串觀察',...threadParts].join(' · '),tone:'blue'};
}
/** The "why" card: title, the six rules (listed accounts only), the AI sentence, the fixed disclaimer and links. */
export function whyCard({username,entry=null,thread=null}){
 const links=[];
 const lines=[];
 let title;
 if(entry&&Number.isInteger(entry.score)){
  const hits=new Set(entry.hits??[]),no=Math.max(0,entry.assessed-hits.size);
  title=`@${username} 查過了：${TOTAL} 項檢查中 ${entry.score} 項符合、${no} 項不符合、${entry.unknown} 項資料不足。`;
  for(const id of SIGNAL_IDS)lines.push({id,label:SIGNAL_LABELS[id],status:hits.has(id)?'yes':'unknown-or-no'});
  if(entry.ai?.summary)lines.push({id:'ai',label:`AI 判讀：${entry.ai.summary}`,status:'ai'});
  if(entry.appeals>0)lines.push({id:'appeals',label:`${entry.appeals} 人按過「信任」`,status:'appeals'});
  if(entry.scanId)links.push({label:'看完整證據',href:scanUrl(entry.scanId)});
 }else{
  title=`@${username}：${THREAD_ONLY_NOTE}`;
  for(const p of threadPhrases(thread))lines.push({id:'thread',label:p,status:'yes'});
  lines.push({id:'thread-note',label:'Whospost 還沒有這個帳號的查詢結果。',status:'unknown-or-no'});
 }
 links.push({label:'申訴或要求刪除',href:PRIVACY_DELETION_URL});
 links.push({label:entry?'用 Whospost 重新查詢':'用 Whospost 查這個帳號',href:checkUrl(username)});
 return {title,lines,note:NOT_IDENTITY,links};
}
/** The counter pill (§3.3): page totals, or the list / layout warning when something is wrong. */
export function counterText(stats,{listStatus='fresh',health='ok',enabled=true}={}){
 if(!enabled)return 'Whospost · 已暫停';
 if(health==='broken')return 'Whospost · Threads 版面已變，等待更新';
 const thread=`本串 ${stats.thread??0}`;
 if(listStatus==='fresh')return `Whospost · 比對 ${stats.checked??0} · 查過 ${stats.listed??0} · 有線索 ${stats.flagged??0} · ${thread}`;
 if(listStatus==='stale')return `Whospost · 清單暫時無法讀取（用舊版） · 比對 ${stats.checked??0} · 查過 ${stats.listed??0} · ${thread}`;
 return `Whospost · 清單暫時無法讀取 · ${thread}`;
}
export const STATUS_TEXT=Object.freeze({ok:'運作中',broken:'Threads 版面已變，等待更新',paused:'已暫停',idle:'開啟 Threads 貼文頁後開始'});
