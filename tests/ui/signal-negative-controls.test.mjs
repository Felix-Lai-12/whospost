import test from 'node:test';import assert from 'node:assert/strict';
import {signalScore} from '../../shared/signals.mjs';
import {reportSummary} from '../../shared/share.mjs';
import {scoreCaveat,groupsHitSummary,ruleWhy} from '../../frontend/src/result-model.mjs';
import {negativeControls} from '../fixtures/signal-negative-controls.mjs';
// Ordinary behaviour that trips one rule each. A threshold change that flags more of them must update the
// pinned expectations on purpose, in the same change.
for(const c of negativeControls())test(`negative control: ${c.label} keeps its pinned score`,()=>{
 const s=signalScore(c.scan);
 assert.equal(s.value,c.expected.value);
 assert.deepEqual(s.items.map(r=>r.status),c.expected.statuses);
 assert.deepEqual(s.groupsHit,c.expected.groupsHit);
 assert.equal(s.unknown,0,'every rule must be observable so the control is a full comparison');
 assert.ok(c.scan.account.username.startsWith('demo.'),'fixtures use invented accounts only');
});
// Output never names a cause. Words that assign identity or intent stay out of every string the rules emit,
// the share summary, and the presentation helpers (Phantomatics test_report_never_claims_attribution).
const ATTRIBUTION=/網軍|水軍|側翼|機器人|假帳號|分身|操作|操弄|操控|幕後|帶風向|有組織|協同/;
const strings=v=>typeof v==='string'?[v]:Array.isArray(v)?v.flatMap(strings):v&&typeof v==='object'?Object.values(v).flatMap(strings):[];
test('result copy contains no attribution words',()=>{
 const empty={account:{username:'demo.empty'},posts:[],comments:[]};
 for(const scan of [empty,...negativeControls().map(c=>c.scan)]){
  const s=signalScore(scan);
  for(const text of [...strings(s),...strings(reportSummary(scan)),scoreCaveat(s),groupsHitSummary(s),...s.items.map(ruleWhy)])assert.doesNotMatch(text,ATTRIBUTION,text);
 }
});
