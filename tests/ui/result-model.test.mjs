import test from 'node:test';import assert from 'node:assert/strict';
import {hasScore,groupKind,scoringLabel,evidenceSummary,factClaims,relevanceLabel,scoreDetails,factEmptyMessage,verificationLabel,claimEvidence,responseTypeLabel,groupReason,followersText} from '../../frontend/src/result-model.mjs';
test('unknown score stays unknown; numeric zero remains valid',()=>{for(const value of [undefined,null,'0',NaN,Infinity])assert.equal(hasScore({value}),false);assert.equal(hasScore({value:0}),true)});
test('cross-thread status must be explicit',()=>{assert.equal(groupKind({records:[{kind:'authored_reply'},{kind:'authored_reply'}]}),'相似發言，討論串關係待確認');assert.match(groupKind({crossThread:true}),/跨他人/)});
test('post evidence is distinguished from authored replies',()=>assert.equal(groupKind({records:[{kind:'post'},{kind:'post'}]}),'本人重複貼文'));
test('short repetition is never represented as scored',()=>assert.equal(scoringLabel({nonScoring:true},{value:90}),'未計分'));
test('legacy long-text group does not invent individual score contribution',()=>assert.equal(scoringLabel({}, {value:0}),'納入重複規則比對'));
test('missing repetition data is not represented as no repetition',()=>assert.match(evidenceSummary({score:{value:0}}),/證據尚未提供/));
test('insufficient data does not inherit a zero conclusion',()=>assert.match(evidenceSummary({score:{value:null},analysis:{repetition:{groups:[]}}}),/不足以評分/));
test('queryText is not treated as an extracted claim',()=>assert.deepEqual(factClaims({queryText:'something'}),[]));
test('legacy fact match remains relevance pending',()=>assert.equal(relevanceLabel({text:'search match'}),'相關性待確認'));
test('optional explicit claims and relevance are honored',()=>{assert.deepEqual(factClaims({claims:['claim',{id:'a',text:'another'}]}),[{text:'claim'},{id:'a',text:'another'}]);assert.equal(relevanceLabel({relevance:{status:'unrelated'}}),'與主張無關')});

test('similar cross-thread texts are not labeled identical',()=>assert.equal(groupKind({crossThread:true,records:[{text:'one'},{text:'two'}]}),'跨他人討論串的近似留言'));

test('no_checkable_claim takes precedence over unavailable',()=>assert.match(factEmptyMessage({status:'unavailable',reasonCode:'no_checkable_claim'}),/沒有擷取到/));
test('only rules-v1 receives legacy formula fallback',()=>{assert.match(scoreDetails({version:'rules-v1'}).details.join(''),/70 ×/);for(const version of [undefined,'rules-v2','rules-v3'])assert.doesNotMatch(scoreDetails({version}).details.join(''),/70|至少 5/)});
test('provided explanation overrides even legacy formula',()=>{const x=scoreDetails({version:'rules-v1',explanation:{summary:'新版依據',formula:'20 × R'}});assert.deepEqual(x.details,['新版依據','20 × R']);assert.doesNotMatch(x.details.join(''),/70 ×/)});
test('component weights and zero contributions are preserved without invented units',()=>assert.deepEqual(scoreDetails({version:'rules-v2',components:{repetition:{label:'重複程度',value:0,weight:0.3,contribution:0}}}).components[0],{label:'重複程度',value:'0',unit:'',weight:'0.3',contribution:'0',reason:'',status:''}));
test('v2 candidate and rejection remain provisional',()=>{assert.equal(relevanceLabel({relevance:{status:'candidate'}}),'文字候選，相關性待核對');assert.equal(relevanceLabel({relevance:{status:'rejected'}}),'未通過相關性篩選');assert.equal(verificationLabel('conflicting_responses'),'回應看法分歧')});
test('claim evidence retains rejected candidates and deduplicates flat items',()=>{const a={id:'a',claimId:'c',relevance:{status:'rejected'}};assert.deepEqual(claimEvidence({id:'c',evidence:[a]},[a,{id:'b',claimId:'other'}]),[a])});
test('reply classification is attributed to responder',()=>assert.equal(responseTypeLabel({type:'RUMOR'}),'回應者認為含有不實資訊'));

test('long non-scoring cross-thread evidence does not become short text',()=>{const group={crossThread:true,nonScoring:true,scoring:{included:false,reason:'僅出現在兩個討論串，未達三串及時間條件。'},records:[{text:'這是一段明確超過短句長度的測試長文。'.repeat(8)},{text:'這是一段明確超過短句長度的測試長文。'.repeat(8)}]};const summary=evidenceSummary({score:{value:0},analysis:{repetition:{groups:[group]}}});assert.match(summary,/本次未計分/);assert.doesNotMatch(summary,/短句|連結/);assert.equal(groupReason(group),group.scoring.reason)});
test('untyped non-scoring evidence gets a neutral reason',()=>assert.equal(groupReason({nonScoring:true}),'本次未計分，保留原文供核對。'));
test('only explicit short type gets short explanation, and backend reason wins',()=>{assert.match(groupReason({type:'short',nonScoring:true}),/短句/);assert.equal(groupReason({type:'short',nonScoring:true,scoring:{reason:'後端原因優先'}}),'後端原因優先')});
test('follower count beside the account name: a saved count with separators, zero as zero, anything else as not obtained',()=>{
 assert.equal(followersText({followers:1234}),'粉絲 1,234');assert.equal(followersText({followers:5753787}),'粉絲 5,753,787');assert.equal(followersText({followers:0}),'粉絲 0');
 for(const account of [{},{followers:null},{followers:-1},{followers:'12'},null,undefined])assert.equal(followersText(account),'粉絲數未取得');
});
