import test from 'node:test';import assert from 'node:assert/strict';import {analyzePost} from '../../shared/post-mode/index.mjs';
const sample=(code='p',author='owner')=>({post:{code,author},comments:Array.from({length:25},(_,i)=>({id:`${code}-${i}`,author:`synthetic_${i}`,text:`這是第 ${i} 位留言者的不同意見`,postedAt:'2026-10-21T00:00:00Z',authorMeta:{hasAvatar:i>8,verified:false}}))});
test('post composition keeps profile unknowns out of denominator and does not infer identity',()=>{
 const input=sample(),result=analyzePost(input,{profiles:{synthetic_0:{followers:2,bio:''}}});
 assert.equal(result.status,'ok');const row=result.composition.find(r=>r.key==='lowFollowers');assert.equal(row.known,1);assert.equal(row.count,1);assert.equal(row.share,1);assert.match(result.disclaimer,/不能用來判定身分/);
 assert.equal(result.cooccurrence.status,'unknown');assert.equal(result.accounts.some(a=>'score' in a),false);
});
test('baseline comparison and exclusion reread use original comments; duplicate corpus posts never create a regular',()=>{
 const input=sample(),baseline=sample('b','baseline_owner'),p={post:{code:'other',author:'someone'},accounts:[{author:'synthetic_0'},{author:'synthetic_1'}]};
 const result=analyzePost(input,{baselineInput:baseline,corpus:[p,p]});assert.equal(result.regulars.length,0);assert.equal(result.cooccurrence.posts.length,1);assert.equal(result.coverage.accounts,25);
 const filtered=analyzePost(input,{baselineInput:baseline,corpus:[p],exclude:['SYNTHETIC_0','synthetic_1']});assert.equal(filtered.coverage.accounts,23);assert.equal(filtered.baseline.coverage.accounts,23);assert.equal(filtered.cooccurrence.posts.length,0);assert.equal(input.comments.length,25);
 const tooFew=analyzePost(input,{exclude:Array.from({length:6},(_,i)=>`synthetic_${i}`)});assert.equal(tooFew.status,'insufficient_data');
});
test('insufficient baseline and same-author-only corpus remain unknown, not a normal comparison',()=>{
 const input=sample(),baseline={...sample('b','other'),comments:sample('b','other').comments.slice(0,5)};
 const result=analyzePost(input,{baselineInput:baseline,corpus:[{post:{code:'same-author',author:'owner'},accounts:[{author:'synthetic_0'},{author:'synthetic_1'}]}]});
 assert.equal(result.baseline.status,'insufficient_data');assert.equal(result.cooccurrence.status,'unknown');assert.doesNotMatch(result.headline,/差不多/);
});
