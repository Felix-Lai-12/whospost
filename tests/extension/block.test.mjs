// 封鎖助手 and 檢舉 (EXTENSION-SPEC §4.5): the cooldown, the local blocked list and its three states, the remote switch,
// and the step runners' rule that a missing element stops the run where it is.
import test from 'node:test';
import assert from 'node:assert/strict';
import {cooldownLeft,withBlocked,withoutBlocked,blockedListView,classifyMenuItem,pickBlockItem,pickReportItem,runBlock,runReport,STEPS,REPORT_STEPS,STEP_TEXT,BLOCK_COOLDOWN_MS} from '../../extension/lib/block.mjs';
import {flagsFromHealth,shouldRefreshFlags,blockEnabled,FLAGS_TTL_MS} from '../../extension/lib/flags.mjs';
import {blockButtonText,reportButtonText,blockResultText} from '../../extension/lib/label.mjs';
const H='c'.repeat(64),T=Date.parse('2026-10-24T08:00:00Z');

test('cooldown: 8 seconds, counted down in whole seconds, then the button is back',()=>{
 assert.equal(BLOCK_COOLDOWN_MS,8000);
 const until=T+BLOCK_COOLDOWN_MS;
 assert.equal(cooldownLeft(until,T),8);assert.equal(cooldownLeft(until,T+7001),1);assert.equal(cooldownLeft(until,T+8000),0);
 assert.equal(cooldownLeft(0,T),0);assert.equal(cooldownLeft(undefined,T),0);assert.equal(cooldownLeft(NaN,T),0);
 assert.deepEqual(blockButtonText({username:'abc',wait:0}),{label:'封鎖 @abc',disabled:false});
 assert.deepEqual(blockButtonText({username:'abc',wait:3}),{label:'3 秒後才能再封鎖',disabled:true});
 assert.equal(reportButtonText({username:'abc'}),'檢舉 @abc');
});

test('blocked list, three states: reading, could not read, empty — never one shown as another; then the accounts newest first',()=>{
 assert.deepEqual(blockedListView({status:'loading'}),{state:'loading',count:null,items:[]});
 assert.deepEqual(blockedListView({status:'error'}),{state:'error',count:null,items:[]});
 assert.equal(blockedListView({status:'ok',blocked:'garbage'}).state,'error','a malformed record is not an empty list');
 assert.deepEqual(blockedListView({status:'ok',blocked:{}}),{state:'empty',count:0,items:[]});
 assert.deepEqual(blockedListView({status:'ok'}),{state:'empty',count:0,items:[]},'nothing stored yet is empty');
 let b=withBlocked({},{h:'a'.repeat(64),username:'first'},T);
 b=withBlocked(b,{h:'b'.repeat(64),username:'second'},T+5);
 const v=blockedListView({status:'ok',blocked:b});
 assert.equal(v.state,'list');assert.equal(v.count,2);assert.deepEqual(v.items.map(x=>x.username),['second','first']);
 const left=withoutBlocked(b,'a'.repeat(64));
 assert.deepEqual(Object.keys(left),['b'.repeat(64)]);assert.equal(Object.keys(b).length,2,'the old record is not changed');
});

test('remote switch: on only when /api/health says block:true; unknown or missing means off; hourly refresh',()=>{
 assert.equal(blockEnabled(null),false,'never fetched');
 assert.equal(blockEnabled(flagsFromHealth({extension:{block:true}},T)),true);
 assert.equal(blockEnabled(flagsFromHealth({extension:{block:false}},T)),false);
 assert.equal(blockEnabled(flagsFromHealth({extension:{block:'1'}},T)),false,'only a real true');
 assert.equal(flagsFromHealth({ok:true},T),null,'an answer without the switches changes nothing');
 assert.equal(shouldRefreshFlags(null,T),true);
 assert.equal(shouldRefreshFlags({block:true,fetchedAt:T},T+FLAGS_TTL_MS-1),false);
 assert.equal(shouldRefreshFlags({block:true,fetchedAt:T},T+FLAGS_TTL_MS),true);
});

test('menu items: Block (or Unblock) and Report, each only when it is exactly one item of the last group',()=>{
 const g=(...t)=>t.map(text=>({el:{text},text}));
 assert.equal(classifyMenuItem(' Block '),'block');assert.equal(classifyMenuItem('封鎖'),'block');assert.equal(classifyMenuItem('解除封鎖'),'unblock');
 assert.equal(classifyMenuItem('Report'),'report');assert.equal(classifyMenuItem('檢舉'),'report');assert.equal(classifyMenuItem('Mute'),null);
 // A reply's menu, measured 10-26; the profile's (10-24) has the same last group without Mute and Restrict.
 const reply=[g('Copy link','Get embed code'),g('Save','Not interested'),g('Add to feed'),g('Mute','Restrict','Block','Report')];
 assert.deepEqual(pickBlockItem(reply),{kind:'block',label:'Block',el:{text:'Block'}});
 assert.deepEqual(pickReportItem(reply),{kind:'report',label:'Report',el:{text:'Report'}});
 assert.equal(pickBlockItem([g('Copy link'),g('Block','Report'),g('Mute')]),null,'Block moved out of the last group: not guessed');
 assert.equal(pickBlockItem([g('Mute','Block','Block')]),null,'two candidates are no item');
 assert.equal(pickReportItem([g('Copy link'),g('Mute')]),null);
 assert.equal(pickBlockItem([]),null);assert.equal(pickBlockItem(null),null);
 assert.equal(pickBlockItem([g('Unblock','Report')]).kind,'unblock');
});

// A fake page: each finder answers from `have` (false = never appears), and every click is logged.
function fakeDom(have={}){
 const clicks=[],dialog={open:true};
 const on=k=>have[k]!==false;
 return {clicks,dialog,
  menuButton:()=>on('menuButton')?'⋯':null,
  blockItem:()=>on('blockItem')?(have.unblock?{kind:'unblock',label:'Unblock',el:'unblock'}:{kind:'block',label:'Block',el:'block'}):null,
  reportItem:()=>on('reportItem')?{kind:'report',label:'Report',el:'report'}:null,
  reportDialog:()=>on('reportDialog')&&clicks.includes('report')?'report window':null,
  confirmButton:(label,username)=>on('confirmButton')&&label==='Block'&&username==='abc'?{el:'confirm',dialog}:null,
  closed:d=>on('confirmClosed')?(d.open===false||clicks.includes('confirm')):false,
  click:el=>clicks.push(el)};
}
const fastClock=()=>{let t=0;return {now:()=>t,sleep:async ms=>{t+=ms;}};};

test('runner: ⋯ → 封鎖 → 確認, each clicked exactly once, in order',async()=>{
 const dom=fakeDom(),steps=[];
 const r=await runBlock({username:'abc',dom,...fastClock(),onStep:s=>steps.push(s)});
 assert.deepEqual(r,{ok:true,status:'blocked'});
 assert.deepEqual(dom.clicks,['⋯','block','confirm']);
 assert.deepEqual(steps,STEPS);
});

test('runner: every step that finds nothing stops the run there — no later click, no second try',async()=>{
 const expected={menuButton:[],blockItem:['⋯'],confirmButton:['⋯','block'],confirmClosed:['⋯','block','confirm']};
 for(const [i,step] of STEPS.entries()){
  const dom=fakeDom({[step]:false});
  const r=await runBlock({username:'abc',dom,...fastClock()});
  assert.deepEqual(r,{ok:false,step,index:i+1,reason:STEP_TEXT[step]},step);
  assert.deepEqual(dom.clicks,expected[step],`${step}: stopped without clicking further`);
 }
});

test('runner: a missing element is waited for up to its timeout, not retried by clicking',async()=>{
 const dom=fakeDom({blockItem:false}),clock=fastClock();let asked=0;
 const inner=dom.blockItem;dom.blockItem=()=>{asked++;return inner();};
 await runBlock({username:'abc',dom,...clock,timeouts:{menuButton:1000,blockItem:900,confirmButton:1000,confirmClosed:1000},interval:300});
 assert.equal(asked,4,'looked at 0, 300, 600, 900 ms, then stopped');
 assert.deepEqual(dom.clicks,['⋯'],'the ⋯ was pressed once');
});

test('runner: an account already blocked (Unblock in its place) is reported as such, nothing else is pressed',async()=>{
 const dom=fakeDom({unblock:true});
 assert.deepEqual(await runBlock({username:'abc',dom,...fastClock()}),{ok:true,status:'already'});
 assert.deepEqual(dom.clicks,['⋯']);
});

test('runner: the confirm dialog must name the account; stopBeforeConfirm leaves it open',async()=>{
 const other=fakeDom();
 assert.equal((await runBlock({username:'someone',dom:other,...fastClock()})).step,'confirmButton');
 const dry=fakeDom();
 assert.deepEqual(await runBlock({username:'abc',dom:dry,...fastClock(),stopBeforeConfirm:true}),{ok:true,status:'dry'});
 assert.deepEqual(dry.clicks,['⋯','block']);
});

test('report: ⋯ → 檢舉, then the report window opens and nothing in it is pressed',async()=>{
 const dom=fakeDom();
 assert.deepEqual(await runReport({dom,...fastClock()}),{ok:true,status:'opened'});
 assert.deepEqual(dom.clicks,['⋯','report']);
 const expected={menuButton:[],reportItem:['⋯'],reportDialog:['⋯','report']};
 for(const [i,step] of REPORT_STEPS.entries()){
  const d=fakeDom({[step]:false});
  assert.deepEqual(await runReport({dom:d,...fastClock()}),{ok:false,step,index:i+1,reason:STEP_TEXT[step]},step);
  assert.deepEqual(d.clicks,expected[step],step);
 }
});

test('wording: says whose decision it is, never judges the account',()=>{
 assert.match(blockResultText('stopped',{reason:STEP_TEXT.blockItem}),/^Threads 版面已變，請自己按（停在：「⋯」選單裡找不到「封鎖」）/);
 assert.equal(blockResultText('opened',{username:'abc'}),'','the report window needs no toast of ours (Felix 10-27)');
 for(const k of ['blocked','already','stopped']){const t=blockResultText(k,{username:'abc',reason:'x'});assert.ok(t);assert.equal(/網軍|假帳號|機器人|判定為/.test(t),false,k);}
});
