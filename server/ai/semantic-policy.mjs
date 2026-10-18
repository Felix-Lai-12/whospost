// Limited deterministic release checks for known unsupported claims, not a semantic classifier.
// Only model-authored prose is inspected; exact evidence quotes remain untouched.
const clauses=text=>String(text).split(/[，,。；;！？!?\n]/u);
// Plain negations ("缺乏…灌水", "未見刷量") deny the claim too, unless a contrast follows ("不是A而是灌水").
const plainNegation=/(?:缺乏|未見|未發現|未顯示|沒有|並非|不是|看不出|無明顯)(?:(?!而是|反而|卻|但|其實)[^，,。；;！？!?\n]){0,10}$/u;
const deniedPrefix=prefix=>plainNegation.test(prefix)||/(?:沒有證據(?:證明|顯示|支持)?|無證據(?:證明|顯示|支持)?|不能(?:據此)?(?:認定|確認|判定|推論)|尚(?:無法|不能)(?:確認|認定|判定|推論)|不代表|不足以(?:證明|支持|認定))[^，,。；;！？!?\n]{0,14}$/u.test(prefix);
function assertion(text,pattern){
 for(const clause of clauses(text)){
  const regex=new RegExp(pattern.source,pattern.flags.includes('g')?pattern.flags:pattern.flags+'g');
  for(const match of clause.matchAll(regex))if(!deniedPrefix(clause.slice(0,match.index)))return true;
 }
 return false;
}
export function validateBehaviorClaims(input,output){
 const fields=[output.conclusion,...output.findings.flatMap(f=>[f.behavior,f.observation,f.interpretation,f.alternative])];
 const problems=[];
 // "可能" is uncertainty about a claim, not evidence that makes an unsupported accusation valid.
 if(fields.some(t=>assertion(t,/人為刷量|刷量|灌水|洗版|刻意(?:放大|增加|製造)|故意(?:放大|增加|製造)|(?:意圖|為了)(?:操弄|刷|製造)|製造互動數|同一經營者|同一組織|分身|主要(?:功能|目的)(?:在於|是)|目的(?:在於|是)|意在|為了(?:維持|增加|提高)|用以維持/u)))problems.push('unsupported_intent_or_operator');
 const replies=input.evidence.filter(e=>e.parentUrl);
 if(replies.some(e=>typeof e.parentText!=='string'||!e.parentText.trim())&&fields.some(t=>assertion(t,/切題|不切題|與原串無關|與原文無關|每次都(?:針對|回應)|均與[^。；，]{0,18}相關/u)))problems.push('missing_parent_context');
 if(input.coverage.sampleOnly&&[output.conclusion,...output.findings.flatMap(f=>[f.behavior,f.observation,f.interpretation])].some(t=>assertion(t,/全天候|一律|總是|所有發言|全部發言|長期|持續多年|一向/u)))problems.push('sample_as_full_history');
 if(problems.length)throw Object.assign(Error('Behavior claim boundary failed: '+problems.join(',')),{code:'SEMANTIC_POLICY_FAILED',problems});
 return {validation:'limited_claim_rules',semanticReview:'not_human_reviewed'};
}
