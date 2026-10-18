// Deterministic candidate extraction: no truth, ideology, or author-intent inference.
export const CLAIM_VERSION = 'claims-v3-classified-deduplicated';
const factual = /宣布|公布|通過|實施|禁止|取消|停課|停班|死亡|確診|感染|治療|致癌|治癒|造成|導致|發生|發放|補助|開放|關閉|下架|撤回|增加|減少|成長|下降|達到|超過|高達|共有|已有/u;
const quantified = /\d+(?:\.\d+)?\s*(?:%|％|人|萬|億|元|件|例|倍|年|月|日|票|名|個)/u;
const technical = /github|開源|程式碼|套件|資料庫|API|React|Python|Wi-?Fi|專案|版本更新|功能分享/iu;
const opinion = /我覺得|我認為|我希望|我喜歡|我討厭|應該|最好|好用|難用|爛透|加油/u;
const satire = /反串|諷刺|開玩笑|設計對白|純屬虛構|笑死|哈哈/u;
const reported = /聽說|據說|有人說|網傳|轉傳|轉述|聲稱|謠言|傳言|「|」|『|』|“|”/u;
const questions = /[？?]|是否|真的嗎|真假/u;
const publicSubject = /政府|市府|衛福部|教育部|中央|法院|警察|公司|研究|醫院|學校|疫苗|食品/u;

export function classifySentence(sentence){
 const explicit=sentence.length>=10&&sentence.length<=800&&factual.test(sentence)&&(quantified.test(sentence)||publicSubject.test(sentence));
 if(satire.test(sentence))return {category:'satire_context_requires_review',checkable:false};
 if(/應該|我希望|最好/u.test(sentence))return {category:'opinion_or_recommendation',checkable:false};
 // Public assertions override technical context, but opinions are not rewritten.
 if(explicit&&publicSubject.test(sentence)&&!opinion.test(sentence))return {category:'public_fact',checkable:true};
 if(technical.test(sentence)||/FPS|效能|記憶體|實測|網頁遊戲|軟體功能/iu.test(sentence))return {category:'technical_sharing',checkable:false};
 if(/^(?:我|我們|自己|昨天我|今天我|上週我|Last week,? I)/iu.test(sentence)&&!publicSubject.test(sentence))return {category:'personal_experience',checkable:false};
 if(opinion.test(sentence))return {category:'opinion_or_recommendation',checkable:false};
 return {category:explicit?'public_fact':'no_explicit_checkable_claim',checkable:explicit};
}

export function extractClaims(records, {maxClaims = 3} = {}) {
  const limit = Math.max(0, Math.min(3, Number.isInteger(maxClaims) ? maxClaims : 3));
  const claims = [], skipped = [], deferredClaims = [];
  const merged = new Map(), seenOccurrences = new Set();
  let eligibleCount = 0;
  for (const record of records ?? []) {
    const text = String(record.text ?? '');
    const source = {id:record.id ?? null,url:record.url ?? null,kind:record.kind ?? 'post',
      postedAt:record.postedAt ?? null,parentUrl:record.parentUrl ?? null,text};
    if (record.isQuote || record.isRepost) { skipped.push({source,reason:'quoted_or_reposted'}); continue; }
    for (const match of text.matchAll(/[^\n。！？!?]+[。！？!?]?/gu)) {
      const original = match[0], sentence = original.trim();
      if (!sentence) continue;
      // Keep an independent public clause after an opinion/technical prefix.
      let selected = sentence;
      const publicStart = sentence.search(/[，,]\s*(?:但|而|不過)?(?:政府|市府|衛福部|教育部|法院|醫院|學校|疫苗|食品)/u);
      if (publicStart>=0 && /opinion|technical_sharing|personal_experience/.test(classifySentence(sentence.slice(0,publicStart)).category)) selected=sentence.slice(publicStart+1).trim().replace(/^(?:但|而|不過)(?=政府|市府|衛福部|教育部|法院|醫院|學校|疫苗|食品)/u,'');
      const opinionTail=selected.search(/[，,]\s*(?:我覺得|我認為|我喜歡|我討厭)/u);
      if(opinionTail>=0&&classifySentence(selected.slice(0,opinionTail)).checkable)selected=selected.slice(0,opinionTail).trim();
      const classification=classifySentence(selected);
      const reason=classification.checkable ? null : classification.category==='public_fact' ? 'no_explicit_checkable_claim' : classification.category;
      if (reason) { skipped.push({sourceId:source.id,sourceUrl:source.url,sentence:selected,reason,category:classification.category,lookupStatus:'not_requested'}); continue; }
      const occurrenceKey=JSON.stringify([source.id,source.url,source.postedAt,match.index,selected]);
      if(seenOccurrences.has(occurrenceKey))continue;seenOccurrences.add(occurrenceKey);
      eligibleCount++;
      const stance=questions.test(selected)?'question':reported.test(selected)?'reported':'asserted';
      const key=stance+':'+selected.normalize('NFKC').replace(/\s+/g,'').replace(/[。.!！?？]+$/u,'');
      const start=match.index+original.indexOf(selected);
      const occurrence={...source,span:{start,end:start+selected.length},originalText:selected,stance};
      if(merged.has(key)){const prior=merged.get(key);if(!prior.sources.some(s=>s.id===occurrence.id&&s.url===occurrence.url&&s.span.start===start&&s.text===occurrence.text&&s.postedAt===occurrence.postedAt))prior.sources.push(occurrence);continue;}
      const candidate={id:`claim-${merged.size+1}`,text:selected,originalText:selected,span:occurrence.span,source,sources:[occurrence],stance,
        category:classification.category,extraction:{method:CLAIM_VERSION,reviewRequired:true,contextWarnings:satire.test(text)?['satire_elsewhere_in_source']:[]},verificationStatus:'not_checked',lookupStatus:'not_requested',verdict:'undetermined',scoreContribution:0,evidence:[]};
      merged.set(key,candidate);
      if(claims.length>=limit){deferredClaims.push(candidate);skipped.push({sourceId:source.id,sourceUrl:source.url,sentence:selected,reason:'claim_limit',category:'public_fact',lookupStatus:'not_requested'});continue;}
      claims.push(candidate);
    }
  }
  return {claims,skipped,deferredClaims,eligibleCount,distinctEligibleCount:merged.size,mergedOccurrences:eligibleCount-merged.size,selectedCount:claims.length,method:CLAIM_VERSION};
}

const clean = text => String(text ?? '').normalize('NFKC').toLowerCase().replace(/https?:\/\/\S+/g,'').replace(/[\p{P}\p{S}\s]/gu,'');
const grams = text => new Set(Array.from({length:Math.max(0,text.length - 2)},(_,i)=>text.slice(i,i+3)));
const uniqueMatches = (text,pattern) => [...new Set(String(text).normalize('NFKC').match(pattern) ?? [])];
const locations = /台北|臺北|新北|台中|臺中|台南|臺南|高雄|桃園|香港|中國|日本|美國|印度/gu;
// Partial overlap is not enough: a candidate may mention the right year/place
// while the actual claim concerns another event. Conservative set comparison.
const different = (a,b) => a.length && b.length && (a.length!==b.length || a.some(value=>!b.includes(value)));
const negationSignature = text => uniqueMatches(text,/(?:(?:並沒有|並未|並不|沒有|不|未)(?:再)?(?:宣布|公布|通過|發生|發放|實施|取消|開放|提供|給予|領取|補助)|沒有|並沒有|並未|並非|不是|未曾|不曾|不會|不能|不得|無法|否認|不實|假的|造謠)/g).sort();

export function assessRelevance(claim, article) {
  const a=clean(claim.text),b=clean(article.text),x=grams(a),y=grams(b);
  const similarity=x.size ? [...x].filter(g=>y.has(g)).length/x.size : 0;
  const reasons=[];
  const sameText=a.length >= 10 && (b===a || b.includes(a));
  if (!sameText && similarity < .75) reasons.push('insufficient_claim_overlap');
  const years=text=>uniqueMatches(text,/(?:19|20)\d{2}年?/g).map(s=>s.replace(/年$/,''));
  if (different(years(claim.text),years(article.text))) reasons.push('different_explicit_year');
  const dates=text=>uniqueMatches(text,/\d{1,2}月\d{1,2}日/g);
  if (different(dates(claim.text),dates(article.text))) reasons.push('different_explicit_date');
  const places=text=>uniqueMatches(text,locations).map(s=>s.replace('臺','台'));
  if (different(places(claim.text),places(article.text))) reasons.push('different_explicit_place');
  if (JSON.stringify(negationSignature(claim.text))!==JSON.stringify(negationSignature(article.text))) reasons.push('negation_or_stance_difference');
  for (const [positive,negative] of [['開放','關閉'],['增加','減少'],['成長','下降'],['通過','否決'],['宣布','否認'],['發放','取消']]) {
    if ((claim.text.includes(positive) && !claim.text.includes(negative) && article.text.includes(negative)) || (claim.text.includes(negative) && !claim.text.includes(positive) && article.text.includes(positive))) reasons.push('opposing_event_predicate');
  }
  const quantities=text=>uniqueMatches(text,/\d+(?:\.\d+)?\s*(?:%|％|人|萬元|億元|元|件|例|倍|票|名)/g);
  if (different(quantities(claim.text),quantities(article.text))) reasons.push('different_explicit_quantity');
  const contextWarnings=[...(claim.extraction?.contextWarnings ?? [])];
  if (reported.test(String(article.text ?? '')) || questions.test(String(article.text ?? ''))) contextWarnings.push('candidate_quotation_or_question_requires_review');
  if (/今年|今天|昨天|明天|本週|近日|目前/u.test(claim.text + String(article.text ?? ''))) contextWarnings.push('relative_time_requires_review');
  if (article.createdAt && claim.source?.postedAt && Math.abs(Date.parse(article.createdAt)-Date.parse(claim.source.postedAt))>366*86400000) contextWarnings.push('publication_date_gap');
  if (claim.stance!=='asserted') contextWarnings.push('question_or_report_not_endorsement');
  return {status:reasons.length?'rejected':'candidate',method:'lexical-context-gates-v2',similarity:Math.round(similarity*1000)/1000,
    reasons,contextWarnings,reviewRequired:true,explanation:'文字比對只篩選待核對候選，尚未確認為同一事件或同一主張。'};
}
