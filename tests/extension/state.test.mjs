import test from 'node:test';
import assert from 'node:assert/strict';
import {decide,groupRuns,renderKey,STATES} from '../../extension/lib/state.mjs';
import {mergeSettings,effectiveMode} from '../../extension/lib/settings.mjs';
import {threadVerdict} from '../../extension/lib/thread.mjs';
// The fold and fade paths are still in the engine; since Felix 10-26 the default is 'label' and the popup offers no
// choice, so these tests ask for 'collapse' by name.
const settings=mergeSettings({mode:'collapse'});
const entry=score=>({h:'a'.repeat(64),score,hits:[],assessed:score==null?0:6,unknown:score==null?6:0,evidence:null,ai:null,scanId:'s',updated:null,appeals:0});
const thread=(replies,sameContent=0)=>threadVerdict({replies,sameContent},settings.thread);
const state=args=>decide({listStatus:'fresh',settings,...args}).state;

test('the eight states exist and a trust mark wins over everything',()=>{
 assert.deepEqual(STATES,['none','info','fade','collapse','trusted','stale','group','blocked']);
 const d=decide({trusted:true,entry:entry(6),thread:thread(20),listStatus:'missing',settings});
 assert.equal(d.state,'trusted');assert.deepEqual(d.reasons,['trusted']);assert.equal(d.flagged,false);
});

test('list hits with the default settings: 0–2 a chip only, ≥3 folded; only-variants dim or chip instead; all-unknown draws nothing',()=>{
 assert.equal(state({entry:entry(0)}),'info');assert.equal(state({entry:entry(2)}),'info');
 assert.equal(state({entry:entry(3)}),'collapse','fold by default');assert.equal(state({entry:entry(6)}),'collapse');
 assert.equal(state({entry:entry(3),mode:'fade'}),'fade','只變淡');assert.equal(state({entry:entry(3),mode:'label'}),'info','只標籤');
 assert.equal(state({entry:entry(null)}),'none','checked, six unknowns: nothing');
 assert.equal(state({entry:entry(null),listStatus:'missing'}),'none','a listed account is known even from an old list');
 const d=decide({entry:entry(4),listStatus:'fresh',settings});
 assert.deepEqual(d.reasons,['list:score=4']);assert.equal(d.level,'list');assert.equal(d.listed,true);assert.equal(d.flagged,true);
});

test('two thresholds: dim from fadeAt, fold from collapseAt when it is set higher',()=>{
 const s=mergeSettings({mode:'collapse',collapseAt:5});
 assert.equal(decide({entry:entry(4),listStatus:'fresh',settings:s}).state,'fade');
 assert.equal(decide({entry:entry(5),listStatus:'fresh',settings:s}).state,'collapse');
 assert.equal(decide({entry:entry(2),listStatus:'fresh',settings:s}).state,'info');
});

test('thread observation (§4.1): 5 replies a chip, 10 folded (dimmed in fade mode), same text from 3 accounts a chip; it combines with the list',()=>{
 assert.equal(state({thread:thread(4)}),'none');assert.equal(state({thread:thread(5)}),'info');
 assert.equal(state({thread:thread(10)}),'collapse');assert.equal(state({thread:thread(10),mode:'fade'}),'fade');assert.equal(state({thread:thread(10),mode:'label'}),'info');
 assert.equal(state({thread:thread(1,3)}),'info');
 const both=decide({entry:entry(1),thread:thread(10),listStatus:'fresh',settings});
 assert.equal(both.state,'collapse','the stronger of the two');assert.equal(both.level,'list');assert.deepEqual(both.reasons,['list:score=1','thread:replies=10']);
 assert.equal(decide({thread:thread(7,3),listStatus:'fresh',settings}).level,'thread');
 assert.equal(decide({thread:thread(7,3),listStatus:'fresh',settings}).threadHit,true);
 // A later reply of the same account gets the empty verdict (engine: firstReplies), so it is none and uncounted even at 10 replies.
 const later=decide({thread:{level:'none',reasons:[],replies:0,sameContent:0},listStatus:'fresh',settings});
 assert.equal(later.state,'none');assert.equal(later.threadHit,false);
});

test('nothing known: none while the list is fresh, stale while it is missing or old, so unreadable never looks like clean',()=>{
 assert.equal(state({}),'none');assert.equal(state({listStatus:'stale'}),'stale');assert.equal(state({listStatus:'missing'}),'stale');
 assert.equal(state({thread:thread(5),listStatus:'missing'}),'info','thread observation works without any list');
 assert.equal(state({thread:thread(10),listStatus:'missing'}),'collapse');
});

test('"顯示" opens a folded reply as dimmed with its chip; label-only (election) keeps only the chip',()=>{
 assert.equal(state({entry:entry(5),shown:true}),'fade');
 assert.equal(state({thread:thread(12),shown:true}),'fade');
 assert.equal(state({entry:entry(5),mode:'fade',shown:true}),'fade');
 assert.equal(state({entry:entry(2),shown:true}),'info','nothing to open');
 assert.equal(state({entry:entry(5),mode:'label'}),'info');
 const election=mergeSettings({mode:'collapse',election:'on'});
 assert.equal(decide({entry:entry(6),listStatus:'fresh',settings:election,mode:effectiveMode(election)}).state,'info');
});

test('groupRuns folds consecutive suspicious replies into one row each, in page order',()=>{
 const c=h=>({h,collapse:true}),n=h=>({h,collapse:false});
 const groups=groupRuns([c('a'),c('b'),n('c'),c('d'),n('e'),n('f'),c('g'),c('h'),c('i')]);
 assert.deepEqual(groups.map(g=>[g.start,g.members.map(m=>m.h)]),[[0,['a','b']],[3,['d']],[6,['g','h','i']]]);
 assert.deepEqual(groupRuns([n('a'),n('b')]),[]);assert.deepEqual(groupRuns([]),[]);
 assert.equal(groupRuns([c('a')])[0].members.length,1,'a run of one is still folded into a row');
});

test('the render key changes only when something the user would see changes',()=>{
 const a=decide({entry:entry(4),listStatus:'fresh',settings}),b=decide({entry:entry(4),listStatus:'fresh',settings}),c=decide({entry:entry(4),thread:thread(5),listStatus:'fresh',settings});
 assert.equal(renderKey('h',a,'fresh|0'),renderKey('h',b,'fresh|0'));
 assert.notEqual(renderKey('h',a,'fresh|0'),renderKey('h',c,'fresh|0'));
 assert.notEqual(renderKey('h',a,'fresh|0'),renderKey('h',a,'stale|0'));
});

test('即時查 (§4.3) adds a live axis: scanning changes nothing but is reported; failed is still none/stale, never 0 hits',()=>{
 const scanning=decide({listStatus:'fresh',settings,live:{status:'scanning'}});
 assert.equal(scanning.state,'none');assert.equal(scanning.live,'scanning');assert.deepEqual(scanning.reasons,['live:scanning']);assert.equal(scanning.listed,false);
 assert.equal(decide({listStatus:'missing',settings,live:{status:'scanning'}}).state,'stale');
 assert.equal(decide({thread:thread(5),listStatus:'fresh',settings,live:{status:'scanning'}}).state,'info','the thread chip stays while the check runs');
 const failed=decide({listStatus:'missing',settings,live:{status:'failed',code:'PROVIDER_FAILED'}});
 assert.equal(failed.state,'stale');assert.equal(failed.live,'failed');assert.equal(failed.listed,false);assert.equal(failed.flagged,false);
 assert.equal(decide({listStatus:'fresh',settings}).live,null);
});

test('a partial (快篩) result draws as info only: a chip, never folded or dimmed, not counted as flagged; the full result folds like a list entry',()=>{
 const partial={status:'partial',entry:{...entry(5),live:true,partial:true}};
 const p=decide({listStatus:'fresh',settings,live:partial});
 assert.equal(p.state,'info');assert.equal(p.level,'live');assert.deepEqual(p.reasons,['quick:score=5']);assert.equal(p.listed,true);assert.equal(p.flagged,false);
 assert.equal(decide({listStatus:'fresh',settings,live:{status:'partial',entry:{...entry(null),live:true}}}).state,'info','a 快篩 with nothing assessable still shows it is running');
 const done={status:'done',entry:{...entry(5),live:true}};
 const d=decide({listStatus:'fresh',settings,live:done});
 assert.equal(d.state,'collapse');assert.equal(d.level,'live');assert.deepEqual(d.reasons,['live:score=5']);assert.equal(d.flagged,true);assert.equal(d.listed,true);
 assert.equal(decide({listStatus:'fresh',settings,live:done,mode:'fade'}).state,'fade');
 assert.equal(decide({listStatus:'missing',settings,live:{status:'done',entry:{...entry(0),live:true}}}).state,'info','checked, nothing found: a chip, not stale');
 assert.equal(decide({listStatus:'missing',settings,live:{status:'done',entry:{...entry(null),live:true}}}).state,'info','checked, nothing assessable: still shows it was checked');
 // The list wins over a live result for the same account; trust wins over both.
 assert.deepEqual(decide({entry:entry(1),listStatus:'fresh',settings,live:done}).reasons,['list:score=1']);
 assert.equal(decide({trusted:true,listStatus:'fresh',settings,live:done}).state,'trusted');
 assert.equal(decide({listStatus:'fresh',settings,live:{status:'done'}}).state,'none','a done without an entry is treated as nothing known');
});

test('封鎖助手: an account on the local blocked list is neither marked nor folded, whatever the list or the thread says',()=>{
 const d=decide({blocked:true,entry:entry(6),thread:thread(20),listStatus:'fresh',settings});
 assert.equal(d.state,'blocked');assert.deepEqual(d.reasons,['blocked']);assert.equal(d.flagged,false);assert.equal(d.threadHit,false);
 assert.equal(decide({blocked:true,trusted:true,entry:entry(3),listStatus:'fresh',settings}).state,'blocked');
 assert.equal(state({blocked:false,entry:entry(3)}),'collapse','off the list: as before');
});

test('the default (Felix 10-26) is label only: a listed account with hits gets its chip, never folded or dimmed',()=>{
 const d=decide({listStatus:'fresh',settings:mergeSettings(null),entry:{...entry(4),hits:['content-comments']}});
 assert.equal(d.state,'info');assert.equal(d.flagged,true);
});
