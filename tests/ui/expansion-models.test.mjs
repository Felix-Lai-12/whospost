import test from 'node:test';import assert from 'node:assert/strict';
import {behaviorTime,samplePercent,knownCount,postRepetitionMessage} from '../../frontend/src/behavior-model.mjs';
import {expandedClaims,claimLookupLabel,claimSources,domainMessage,budgetBlocked} from '../../frontend/src/factcheck-expansion-model.mjs';
test('partial timestamps never claim a complete duration',()=>{const s=behaviorTime({status:'partial',validCount:2,missingCount:1,knownSpanSeconds:60,spanSeconds:null});assert.match(s,/時間不完整/);assert.match(s,/不代表完整跨度/);assert.doesNotMatch(s,/時間跨度/)});
test('missing time is unknown, not zero or a rate',()=>assert.equal(behaviorTime({status:'unavailable'}),'時間尚未取得，不推估跨度或速率'));
test('complete duration preserves real zero and 32m40s',()=>{assert.equal(behaviorTime({status:'available',spanSeconds:1960}),'時間跨度 32 分 40 秒');assert.equal(behaviorTime({status:'available',spanSeconds:0}),'時間跨度 0 秒')});
test('null percentages and counts do not become zero',()=>{assert.equal(samplePercent(null),'占比未取得');assert.equal(knownCount(undefined),'未取得');assert.equal(samplePercent(.0625),'6.25%')});
test('missing group payload is not no repetition',()=>assert.match(postRepetitionMessage({status:'available'}),/尚未提供/));
test('deferred claims remain visible and unqueried',()=>{const x=expandedClaims({claims:[{id:'a',text:'one'}],extraction:{deferredClaims:[{id:'b',text:'two',verificationStatus:'not_checked',lookupStatus:'not_requested'}]}});assert.equal(x.length,2);assert.equal(claimLookupLabel(x[1]),'超出本次查詢上限 · 尚未查詢')});
test('failed and unrequested lookups are not no match',()=>{assert.equal(claimLookupLabel({lookupStatus:'failed'}),'檢索失敗');assert.equal(claimLookupLabel({lookupStatus:'not_requested'}),'尚未查詢')});
test('merged claims retain distinct sources while deduplicating one occurrence',()=>{const a={id:'a',url:'https://example.com/a',span:{start:0,end:2}},b={id:'b',url:'https://example.com/b',span:{start:0,end:2}};assert.deepEqual(claimSources({sources:[a,a,b]}),[a,b])});
test('domain lookup status remains independent from no claim',()=>{assert.match(domainMessage({status:'not_requested'}),/尚未查詢/);assert.match(domainMessage({status:'no_match'}),/不代表網址安全/);assert.match(domainMessage({status:'not_applicable'}),/沒有可檢查的網址/)});
test('zero fetched data alone never implies budget blocked',()=>assert.equal(budgetBlocked({posts:[],comments:[]}),false));
test('explicit budget codes are recognized without using account names',()=>{assert.equal(budgetBlocked({error:{code:'BUDGET_EXCEEDED'}}),true);assert.equal(budgetBlocked({collectionStatus:'budget_blocked'}),true)});

test('a single known time never produces zero estimated interval',()=>assert.doesNotMatch(behaviorTime({status:'partial',validCount:1,missingCount:1,knownSpanSeconds:0}),/相隔 0|跨度 0/));
test('budget partial collection errorCode is recognized',()=>assert.equal(budgetBlocked({collection:{status:'partial',errorCode:'BUDGET_EXCEEDED'}}),true));

import {groupKind,groupReason,scoreDetails,evidenceSummary} from '../../frontend/src/result-model.mjs';
test('v3 short types never label text as long',()=>{for(const type of ['short_exact','short_template','common_short'])assert.doesNotMatch(groupKind({type}),/長文/);assert.match(groupKind({type:'short_template'}),/共同句型/);assert.match(groupReason({type:'common_short'}),/不計分/)});
test('v3 hint states calibration and minimum denominator',()=>{const hint=scoreDetails({version:'rules-v3.1-observed-repetition',explanation:'formula'});assert.match(hint.details.join(' '),/至少 5 筆/);assert.match(hint.details.join(' '),/尚未校準/)});
test('short repetition is not summarized as no repetitions',()=>assert.doesNotMatch(evidenceSummary({score:{value:14},analysis:{repetition:{status:'available',groups:[{type:'short_exact',records:[{kind:'post'},{kind:'post'}]}]}}}),/未找到/));
