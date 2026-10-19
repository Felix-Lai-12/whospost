import {matchDomainHistory} from './domain-history.mjs';
import {extractClaims, assessRelevance} from '../claims.mjs';

// Fields and enum meanings checked against cofacts/rumors-api src/graphql/models.
export const COFACTS_QUERY = `query($like:String){ListArticles(first:3,filter:{moreLikeThis:{like:$like,minimumShouldMatch:"50%"}}){edges{node{id text status createdAt articleReplies{status reply{id text type reference status createdAt}}}}}}`;
export const COFACTS_ATTRIBUTION = '本編輯資料取自「Cofacts 真的假的」訊息回報機器人與查證協作社群，採 CC BY-SA 4.0 授權提供。若欲補充資訊請訪問 Cofacts LINE bot https://line.me/ti/p/@cofacts';
export const REPLY_TYPE_LABELS = {RUMOR:'回應者認為含有不實資訊',NOT_RUMOR:'回應者認為不含不實資訊',OPINIONATED:'回應者認為屬個人觀點',NOT_ARTICLE:'回應者認為不屬適用的完整網傳訊息'};
const str = value => typeof value === 'string' ? value : '';
const active = value => value === 'NORMAL';
const license = {attribution:COFACTS_ATTRIBUTION,license:'CC BY-SA 4.0',licenseUrl:'https://creativecommons.org/licenses/by-sa/4.0/',dataTermsUrl:'https://github.com/cofacts/rumors-api/blob/master/LEGAL.md'};
const urls = text => [...new Set((text.match(/https?:\/\/[^\s<>"）)]+/g) ?? [])
  .map(value=>value.replace(/[。，、；！？,.!;]+$/u,''))
  .filter(value=>{try {return ['http:','https:'].includes(new URL(value).protocol);}catch{return false;}}))];

function candidate(node, claim) {
  const replies = (Array.isArray(node.articleReplies) ? node.articleReplies : [])
    .filter(x => active(x?.status) && x.reply?.id && active(x.reply.status))
    .map(({reply}) => ({id:str(reply.id),text:str(reply.text),type:reply.type,
      typeLabel:REPLY_TYPE_LABELS[reply.type] ?? '未知回應類型',reference:str(reply.reference),
      sourceUrls:urls(str(reply.reference)),sourcesVerified:false,status:reply.status,
      createdAt:reply.createdAt ?? null,url:`https://cofacts.tw/reply/${encodeURIComponent(reply.id)}`,
      attribution:COFACTS_ATTRIBUTION}));
  const relevance = assessRelevance(claim, node);
  const types = new Set(replies.map(r => r.type));
  const verificationStatus = relevance.status === 'rejected' ? 'irrelevant_candidate' :
    relevance.contextWarnings.length ? 'context_review_required' :
    types.has('RUMOR') && types.has('NOT_RUMOR') ? 'conflicting_responses' :
    replies.length ? 'responses_available' : 'unanswered';
  return {id:str(node.id),text:str(node.text),url:`https://cofacts.tw/article/${encodeURIComponent(node.id)}`,
    status:node.status,createdAt:node.createdAt ?? null,replies,claimId:claim.id,
    sourcePostId:claim.source.id,sourceUrl:claim.source.url,sourceOccurrences:claim.sources??[claim.source],relevance,verificationStatus,
    verdict:'undetermined',scoreContribution:0,...license};
}

export async function fetchFactChecks(records, {fetchImpl=globalThis.fetch,maxClaims=3,domainSnapshot}={}) {
  const {claims,...extraction} = extractClaims(records, {maxClaims});
  const base = {...license,version:'factchecks-v3-deduplicated',claims,items:[],extraction,scoreContribution:0,unqueriedClaimCount:extraction.deferredClaims.length,fullySearched:false,domainChecks:matchDomainHistory(records,domainSnapshot),
    reason:'先核對原句、事件與時空，再閱讀查核回應；收錄或查無都不是真假判定，也不代表作者受雇。'};
  if (!claims.length && extraction.deferredClaims.length) return {...base,status:'unavailable',reasonCode:'claims_not_requested',reason:'已選出可查主張，但本次未執行查詢；不能顯示成查無。'};
  if (!claims.length) return {...base,status:'unavailable',reasonCode:'no_checkable_claim',reason:'本次未選出待查主張；技術功能、效能與個人經驗未完整涵蓋，不代表內容已驗證為真。'};
  // Claims are looked up at the same time; their candidates are merged in claim order below.
  const found=await Promise.all(claims.map(async claim=>{
    try {
      claim.lookupStatus='requested';
      const response=await fetchImpl('https://api.cofacts.tw/graphql',{method:'POST',headers:{'Content-Type':'application/json','User-Agent':'Whospost/0.2 (local fact-check client)',...(process.env.COFACTS_APP_SECRET?{'x-app-secret':process.env.COFACTS_APP_SECRET}:{})},body:JSON.stringify({query:COFACTS_QUERY,variables:{like:claim.text}}),signal:AbortSignal.timeout(15000),redirect:'manual'});
      if (!response.ok) throw Error('HTTP');
      const body=await response.json();
      if (body.errors || !Array.isArray(body.data?.ListArticles?.edges)) throw Error('GraphQL');
      claim.lookupStatus='completed';
      claim.retrievedCandidateCount=body.data.ListArticles.edges.length;
      claim.evidence=body.data.ListArticles.edges.map(edge=>edge?.node)
        .filter(node=>node?.id && typeof node.text==='string' && active(node.status)).slice(0,3).map(node=>candidate(node,claim));
      const related=claim.evidence.filter(item=>item.relevance.status==='candidate');
      claim.verificationStatus=related.length?'candidates_found':'no_match';
      claim.activeCandidateCount=claim.evidence.length;
      claim.rejectedCandidateCount=claim.evidence.filter(x=>x.relevance.status==='rejected').length;
      claim.searchScope='Cofacts moreLikeThis top 3; not exhaustive';
      claim.reason=related.length?'找到文字相關候選，尚待核對來源與上下文。':'未找到通過本次相關性篩選的候選；不代表為真。';
      return related;
    } catch {
      claim.lookupStatus='failed';
      claim.verificationStatus='error';
      claim.reason='Cofacts 查詢暫時失敗；此主張尚未完成檢索。';
      return null;
    }
  }));
  const errors=found.filter(related=>related===null).length;
  for (const related of found) if (related) base.items.push(...related);
  // Existing API fields stay available. queryText is now the extracted claim.
  return {...base,status:base.items.length?'available':errors?'error':'no_match',
    partialFailure:errors>0 && errors<claims.length,failedClaimCount:errors,fullySearched:errors===0&&extraction.deferredClaims.length===0,
    queryText:claims[0].text,sourcePostId:claims[0].source.id};
}
