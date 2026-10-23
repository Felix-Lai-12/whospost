import test from 'node:test';
import assert from 'node:assert/strict';
import {decide,renderKey,STATES} from '../../extension/lib/state.mjs';
import {mergeSettings,effectiveMode} from '../../extension/lib/settings.mjs';
import {threadVerdict} from '../../extension/lib/thread.mjs';
const settings=mergeSettings(null);
const entry=score=>({h:'a'.repeat(64),score,hits:[],assessed:score==null?0:6,unknown:score==null?6:0,evidence:null,ai:null,scanId:'s',updated:null,appeals:0});
const thread=(replies,sameContent=0)=>threadVerdict({replies,sameContent},settings.thread);
const state=args=>decide({listStatus:'fresh',settings,...args}).state;

test('the six states exist and a trust mark wins over everything',()=>{
 assert.deepEqual(STATES,['none','info','fade','collapse','trusted','stale']);
 const d=decide({trusted:true,entry:entry(6),thread:thread(20),listStatus:'missing',settings});
 assert.equal(d.state,'trusted');assert.deepEqual(d.reasons,['trusted']);assert.equal(d.flagged,false);
});

test('list hits (§3.2): 0–2 info, ≥3 fade, ≥4 collapse only in collapse mode; all-unknown draws nothing',()=>{
 assert.equal(state({entry:entry(0)}),'info');assert.equal(state({entry:entry(2)}),'info');
 assert.equal(state({entry:entry(3)}),'fade');assert.equal(state({entry:entry(4)}),'fade','fade mode never collapses');
 assert.equal(state({entry:entry(4),mode:'collapse'}),'collapse');assert.equal(state({entry:entry(3),mode:'collapse'}),'fade');
 assert.equal(state({entry:entry(null)}),'none','checked, six unknowns: no bar');
 assert.equal(state({entry:entry(null),listStatus:'missing'}),'none','a listed account is known even from an old list');
 const d=decide({entry:entry(4),listStatus:'fresh',settings});
 assert.deepEqual(d.reasons,['list:score=4']);assert.equal(d.level,'list');assert.equal(d.listed,true);assert.equal(d.flagged,true);
});

test('thread observation (§4.1): 5 replies info, 10 fade, same text from 3 accounts info; it combines with the list',()=>{
 assert.equal(state({thread:thread(4)}),'none');assert.equal(state({thread:thread(5)}),'info');assert.equal(state({thread:thread(10)}),'fade');
 assert.equal(state({thread:thread(1,3)}),'info');
 const both=decide({entry:entry(1),thread:thread(10),listStatus:'fresh',settings});
 assert.equal(both.state,'fade','the stronger of the two');assert.equal(both.level,'list');assert.deepEqual(both.reasons,['list:score=1','thread:replies=10']);
 assert.equal(decide({thread:thread(7,3),listStatus:'fresh',settings}).level,'thread');
 assert.equal(decide({thread:thread(7,3),listStatus:'fresh',settings}).threadHit,true);
});

test('nothing known: none while the list is fresh, stale while it is missing or old, so unreadable never looks like clean',()=>{
 assert.equal(state({}),'none');assert.equal(state({listStatus:'stale'}),'stale');assert.equal(state({listStatus:'missing'}),'stale');
 assert.equal(state({thread:thread(5),listStatus:'missing'}),'info','thread observation works without any list');
 assert.equal(state({thread:thread(10),listStatus:'missing'}),'fade');
});

test('"顯示" and label-only mode (election) bring fade and collapse down to a bar, never remove it',()=>{
 assert.equal(state({entry:entry(5),mode:'collapse',shown:true}),'info');
 assert.equal(state({thread:thread(12),shown:true}),'info');
 assert.equal(state({entry:entry(5),mode:'label'}),'info');
 const election=mergeSettings({mode:'collapse',election:'on'});
 assert.equal(decide({entry:entry(6),listStatus:'fresh',settings:election,mode:effectiveMode(election)}).state,'info');
 assert.equal(state({entry:entry(1),shown:true}),'info');
});

test('the render key changes only when something the user would see changes',()=>{
 const a=decide({entry:entry(4),listStatus:'fresh',settings}),b=decide({entry:entry(4),listStatus:'fresh',settings}),c=decide({entry:entry(4),thread:thread(5),listStatus:'fresh',settings});
 assert.equal(renderKey('h',a,'fresh|0'),renderKey('h',b,'fresh|0'));
 assert.notEqual(renderKey('h',a,'fresh|0'),renderKey('h',c,'fresh|0'));
 assert.notEqual(renderKey('h',a,'fresh|0'),renderKey('h',a,'stale|0'));
});
