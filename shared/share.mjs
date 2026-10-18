import {signalScore} from './signals.mjs';
export function reportSummary(scan){const score=signalScore(scan),hits=score.items.filter(r=>r.status==='yes'),top=scan.analysis?.interactionConcentration?.authors?.[0];const title=score.value===null?'資料不足，暫不判斷':hits.length?`有 ${hits.length} 項值得注意`:'這次未發現符合加分條件的行為';const reasons=hits.map(r=>r.id==='author-focus'&&top?`${scan.comments.length} 則可分析留言中，${top.count} 則回覆 @${top.author}（${Math.round(top.count/scan.comments.length*100)}%），分布在 ${top.distinctThreads} 篇貼文下。`:r.detail);return {score,title,reasons:reasons.length?reasons:['已取得的資料中，沒有行為達到目前的加分門檻。'],counts:`符合 ${hits.length} 項 · 未符合 ${score.assessed-hits.length} 項 · 資料不足 ${score.unknown} 項`};}
// Copy-to-clipboard text for a result page; the URL is the page's own address once deployed.
export const resultShareUrl=(origin,pathname,scanId)=>`${origin}${pathname}?scan=${encodeURIComponent(scanId)}`;
export const resultShareText=url=>`我已經分析完這個 Thread 帳號的歷史發言：${url}`;
