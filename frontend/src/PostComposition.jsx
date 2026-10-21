import React,{useMemo,useState} from 'react';
import {analyzePost} from '../../shared/post-mode/index.mjs';
import {handle} from '../../shared/post-mode/analyze.mjs';
import './post-composition.css';
const percent=value=>value===null?'未知':`${Math.round(value*100)}%`;
/** Prepared view; production entry waits for the Phase 0 data/coverage acceptance gate. */
export default function PostComposition({input,profiles={},corpus=[],baselineInput=null,baselineProfiles={}}){
 const [exclude,setExclude]=useState([]);
 const result=useMemo(()=>analyzePost(input,{profiles,corpus,baselineInput,baselineProfiles,exclude}),[input,profiles,corpus,baselineInput,baselineProfiles,exclude]);
 const authors=[...new Set((input.comments??[]).map(c=>handle(c.author)).filter(a=>a&&a!==handle(input.post?.author)))].sort();
 return <section className="post-composition" aria-label="留言者組成">
  <h1>誰在這串留言</h1><p role="status">{result.status==='ok'?result.headline:result.reason}</p>
  <p className="muted">取回 {result.coverage.validComments??result.coverage.valid??input.comments?.length} 則留言；本次分析 {result.coverage.accounts} 位留言者，{result.coverage.profiled} 位有個人頁資料。</p>
  <p className="post-note">{result.disclaimer}</p>
  {result.status==='ok'&&<><h2>這篇與對照</h2><p className="muted">窄螢幕可左右滑動表格，查看對照與差異。{result.baseline?.status==='insufficient_data'?'對照留言者不足 20 位，無法比較。':''}</p><div className="post-table-wrap"><table><thead><tr><th>特徵</th><th>這篇</th><th>對照</th><th>差異</th></tr></thead><tbody>{result.composition.map(row=><tr key={row.key}><th scope="row">{row.name}</th><td>{percent(row.share)}<small>{row.count}／{row.known} 位有資料</small></td><td>{row.baseline?percent(row.baseline.share):'無對照'}{row.baseline&&<small>{row.baseline.known} 位有資料</small>}</td><td>{row.aboveZero?'對照是 0%':row.ratio===null?'無法計算':`${row.ratio} 倍`}</td></tr>)}</tbody></table></div>
  <h2>跨文共同出現</h2><p>{result.cooccurrence.limitation}</p>{result.cooccurrence.status==='unknown'?<p>沒有對照庫，還無法判斷。</p>:result.cooccurrence.posts.length?result.cooccurrence.posts.map(p=><p key={p.post.code}>貼文 {p.post.code}：{p.accounts.map(a=>`@${a}`).join('、')}</p>):<p>取回樣本中沒有兩人以上共同出現的其他作者貼文。</p>}</>}
  <h2>排除帳號後重讀</h2><p>勾選後立即重算本篇、對照與共同出現；原始資料保留。排除不代表身分判定。</p>
  <button type="button" className="post-reset" onClick={()=>setExclude([])}>恢復所有帳號</button>
  <div className="post-accounts">{authors.map(author=><label key={author}><input type="checkbox" aria-label={`排除 @${author}`} checked={exclude.includes(author)} onChange={e=>setExclude(old=>e.target.checked?[...old,author]:old.filter(a=>a!==author))}/><span>排除 @{author}</span><a href={`/?u=${encodeURIComponent(author)}`}>查這個帳號</a></label>)}</div>
  <details><summary>這串的留言原文</summary>{(input.comments??[]).filter(c=>!exclude.includes(handle(c.author))).map(c=><p key={c.id}><strong>@{c.author}</strong>：{c.text}</p>)}</details>
 </section>;
}
