// Pre-publication staging only. No semantic classifier, transport, UI or DB writes.
import {createHash} from 'node:crypto';
import {validateAccountBehavior} from './account-behavior-preview.mjs';

export const behaviorReviewChecklist = Object.freeze([
 {id:'parent_context',question:'有關回覆切題／不切題的解讀，是否有實際原串內文支持？若沒有，是否明確留為未知？'},
 {id:'operator_identity',question:'是否沒有從 handle 或名稱猜測分身、同一經營者或組織？一般自然解釋是否仍保留為可能？'},
 {id:'intent',question:'是否區分可見活動、可能效果與未證明的動機，避免把重複／集中直接寫成刻意操弄？'},
 {id:'scope_and_quotes',question:'日期、分母、逐字引用與研究適用性是否正確？是否避免跨期間合併、部分推為全部及截斷原意？'},
 {id:'qualitative_and_readable',question:'是否先給判斷、列具體理由，且用自然中文解釋行為而非只改寫統計？'}
].map(Object.freeze));

const fingerprint=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

/**
 * Call after JSON.parse and before preparing a public report.
 * publicResult is always null here: a separate trusted human review workflow must
 * resolve the checklist against these exact input/output hashes before publishing.
 * Do not treat validateAccountBehavior() === true as permission to publish.
 * Model fields, regex hits and a caller-supplied `approved` flag are not reviews.
 */
export function gateAccountBehaviorResult(input,output){
 let error;
 try{validateAccountBehavior(input,output);}catch(e){error=e instanceof Error?e.message:'Invalid input/output';}
 if(error)return {publicationState:'blocked_invalid',publicResult:null,reviewRequired:true,structuralError:error,semanticReview:'not_performed'};
 return {
  publicationState:'pending_human_review',publicResult:null,reviewRequired:true,
  inputHash:fingerprint(input),outputHash:fingerprint(output),
  semanticReview:'not_performed',checklist:behaviorReviewChecklist,
  // Metadata identifies missing data, not whether the model's interpretation is correct.
  contextCoverage:{replyCount:input.evidence.filter(e=>e.parentUrl).length,repliesWithParentText:input.evidence.filter(e=>e.parentUrl&&typeof e.parentText==='string'&&e.parentText.trim()).length}
 };
}
