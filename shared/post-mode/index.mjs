import {composePost} from './compose.mjs';
import {handle} from './analyze.mjs';
const uniquePosts=corpus=>[...new Map(corpus.filter(p=>p?.post?.code).map(p=>[p.post.code,p])).values()];
/** Reread the original sample after exclusions. Never changes the saved source or assigns identity labels. */
export function analyzePost(input,{profiles={},known={},corpus=[],baselineInput=null,baselineProfiles={},exclude=[]}={}){
 const excluded=new Set(exclude.map(handle));
 const filter=sample=>({...sample,comments:(sample.comments??[]).filter(c=>!excluded.has(handle(c.author)))});
 const peers=uniquePosts(corpus).map(p=>({...p,accounts:(p.accounts??[]).filter(a=>!excluded.has(handle(a.author)))}));
 const baseline=baselineInput?composePost(filter(baselineInput),{profiles:baselineProfiles,corpus:peers,known}):null;
 const result=composePost(filter(input),{profiles,known,corpus:peers,baseline:baseline?.status==='ok'?baseline:null});
 const current=new Set((result.accounts??[]).map(a=>handle(a.author)));
 const others=peers.filter(p=>p.post.code!==input.post?.code&&handle(p.post.author)!==handle(input.post?.author));
 const cooccurrence=others.map(p=>({post:p.post,accounts:[...new Set((p.accounts??[]).map(a=>handle(a.author)))].filter(a=>current.has(a))})).filter(p=>p.accounts.length>=2);
 return {...result,baseline:baseline?{post:baseline.post,status:baseline.status,coverage:baseline.coverage}:null,excluded:[...excluded].sort(),cooccurrence:{status:others.length?'available':'unknown',posts:cooccurrence,limitation:'共同出現只描述取回樣本；熱門帳號也可能重疊，不代表協同行為或身分。'},disclaimer:'沒有大頭貼、追蹤數少於 10 都只是特徵，不能用來判定身分。'};
}
