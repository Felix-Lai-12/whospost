// 封鎖助手 (EXTENSION-SPEC §4.5): the cooldown, the hand-over between tabs, the local blocked list and its three states,
// the remote switch, and the step runner's rule that a missing element stops the run where it is.
import test from 'node:test';
import assert from 'node:assert/strict';
import {cooldownLeft,newIntent,intentFor,withBlocked,withoutBlocked,blockedListView,classifyMenuItem,pickBlockItem,runBlock,STEPS,STEP_TEXT,BLOCK_COOLDOWN_MS,INTENT_TTL_MS} from '../../extension/lib/block.mjs';
import {flagsFromHealth,shouldRefreshFlags,blockEnabled,blockShipped,BLOCK_SINCE,FLAGS_TTL_MS} from '../../extension/lib/flags.mjs';
import {runBlockPage} from '../../extension/lib/block-page.mjs';
import {blockButtonText,blockBarText,BLOCK_NOTE} from '../../extension/lib/label.mjs';
const H='c'.repeat(64),T=Date.parse('2026-10-24T08:00:00Z');

test('cooldown: 8 seconds, counted down in whole seconds, then the button is back',()=>{
 assert.equal(BLOCK_COOLDOWN_MS,8000);
 const until=T+BLOCK_COOLDOWN_MS;
 assert.equal(cooldownLeft(until,T),8);assert.equal(cooldownLeft(until,T+7001),1);assert.equal(cooldownLeft(until,T+8000),0);
 assert.equal(cooldownLeft(0,T),0);assert.equal(cooldownLeft(undefined,T),0);assert.equal(cooldownLeft(NaN,T),0);
 assert.deepEqual(blockButtonText({username:'abc',wait:0}),{label:'封鎖 @abc',disabled:false});
 assert.deepEqual(blockButtonText({username:'abc',wait:3}),{label:'3 秒後才能再封鎖',disabled:true});
});

test('hand-over: only for this account\'s profile path, pressed within 30 seconds, and only well-formed',()=>{
 const i=newIntent({username:'Some.User_1',h:H},T);
 assert.deepEqual(i,{username:'some.user_1',h:H,at:T});
 assert.equal(newIntent({username:'bad name',h:H},T),null);assert.equal(newIntent({username:'ok',h:'xyz'},T),null);
 assert.equal(intentFor(i,'/@some.user_1',T+1000),i);
 assert.equal(intentFor(i,'/@Some.User_1/',T+1000),i,'case and a trailing slash do not matter');
 assert.equal(intentFor(i,'/@other',T+1000),null,'another account');
 assert.equal(intentFor(i,'/@some.user_1/post/ABC',T+1000),null,'a post page is not the profile');
 assert.equal(intentFor(i,'/@some.user_1',T+INTENT_TTL_MS+1),null,'too old');
 assert.equal(intentFor(null,'/@some.user_1',T),null);
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

test('version gate: 封鎖助手 ships from 0.2.0; below it the site\'s switch is ignored',()=>{
 assert.equal(BLOCK_SINCE,'0.2.0');
 for(const v of ['0.2.0','0.2.1','0.10.0','1.0','1.0.0.1'])assert.equal(blockShipped(v),true,v);
 for(const v of ['0.1.0','0.1.9','0.1','0',undefined,null,'','x.y','0.2.x'])assert.equal(blockShipped(v),false,String(v));
 assert.equal(blockEnabled(flagsFromHealth({extension:{block:true}},T,'0.1.0')),false,'0.1.0 never shows the button');
 assert.deepEqual(flagsFromHealth({extension:{block:true}},T,'0.1.0'),{block:false,fetchedAt:T},'still a record, so the hourly refresh does not hammer health');
 assert.equal(blockEnabled(flagsFromHealth({extension:{block:true}},T,'0.2.0')),true);
});

test('menu item: the first item of the last group, only when its label is Block (or Unblock); anything else is no item',()=>{
 const g=(...t)=>t.map(text=>({el:{text},text}));
 assert.equal(classifyMenuItem(' Block '),'block');assert.equal(classifyMenuItem('封鎖'),'block');assert.equal(classifyMenuItem('解除封鎖'),'unblock');assert.equal(classifyMenuItem('Report'),null);
 const measured=[g('Copy link','About this profile','Add to feed'),g('Mute','Restrict'),g('Block','Report')];
 assert.deepEqual(pickBlockItem(measured),{kind:'block',label:'Block',el:{text:'Block'}});
 assert.equal(pickBlockItem([g('Copy link'),g('Report','Block')]),null,'Block moved: not guessed');
 assert.equal(pickBlockItem([g('Copy link'),g('Mute')]),null);
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

// A minimal document for the bar the profile tab shows.
function fakeDoc(){
 const make=tag=>{const n={tag,children:[],dataset:{},attrs:{},className:'',textContent:'',listeners:{},
  append(...c){n.children.push(...c);},remove(){n.removed=true;},setAttribute(k,v){n.attrs[k]=v;},addEventListener(t,f){n.listeners[t]=f;},
  querySelector(sel){const cls=sel.slice(1);const walk=x=>x.className===cls?x:x.children.map(walk).find(Boolean)??null;return walk(n);}};return n;};
 const root=make('html');
 return {documentElement:root,createElement:make,bar:()=>root.children.find(c=>c.className==='whospost-blockbar')};
}
function fakeStorage(init={}){
 const s={blocked:{},flags:{block:true,fetchedAt:T},blockIntent:null,blockCooldownUntil:0,...init};
 return {s,getBlockIntent:async()=>s.blockIntent,clearBlockIntent:async()=>{s.blockIntent=null;},getFlags:async()=>s.flags,getBlocked:async()=>s.blocked,setBlocked:async b=>{s.blocked=b;},setCooldownUntil:async t=>{s.blockCooldownUntil=t;}};
}
const page=(path,storage,run,now=T+2000)=>{const doc=fakeDoc();return {doc,go:()=>runBlockPage({storage,doc,win:{location:{pathname:path}},now:()=>now,dom:{},run})};};

test('profile tab: no hand-over, or one for another page, does nothing at all',async()=>{
 let ran=0;const run=async()=>{ran++;return {ok:true,status:'blocked'};};
 const none=fakeStorage();assert.equal(await page('/@abc',none,run).go(),null);
 const other=fakeStorage({blockIntent:{username:'xyz',h:H,at:T}});const p=page('/@abc',other,run);
 assert.equal(await p.go(),null);assert.equal(ran,0);assert.equal(p.doc.bar(),undefined);
 assert.deepEqual(other.s.blockIntent,{username:'xyz',h:H,at:T},'left for the tab it was meant for');
});

test('profile tab: success → the hand-over is used up, the account is on the local list, the cooldown restarts, the bar says so',async()=>{
 const storage=fakeStorage({blockIntent:{username:'abc',h:H,at:T}});
 const p=page('/@abc',storage,async({username})=>{assert.equal(username,'abc');return {ok:true,status:'blocked'};});
 assert.deepEqual(await p.go(),{ok:true,status:'blocked'});
 assert.equal(storage.s.blockIntent,null);
 assert.deepEqual(storage.s.blocked[H],{username:'abc',at:T+2000});
 assert.equal(storage.s.blockCooldownUntil,T+2000+BLOCK_COOLDOWN_MS);
 const bar=p.doc.bar();assert.equal(bar.dataset.whospostBlock,'blocked');
 assert.match(bar.querySelector('.whospost-blockbar-msg').textContent,/已封鎖 @abc/);
 assert.equal(bar.querySelector('.whospost-blockbar-note').textContent,BLOCK_NOTE);
 // A reload of the same tab finds no hand-over and clicks nothing.
 let again=0;assert.equal(await page('/@abc',storage,async()=>{again++;}).go(),null);assert.equal(again,0);
});

test('profile tab: a stop keeps the account off the list and says 「Threads 版面已變，請自己按」 with the step',async()=>{
 const storage=fakeStorage({blockIntent:{username:'abc',h:H,at:T}});
 const p=page('/@abc',storage,async()=>({ok:false,step:'blockItem',index:2,reason:STEP_TEXT.blockItem}));
 assert.equal((await p.go()).step,'blockItem');
 assert.deepEqual(storage.s.blocked,{});
 assert.equal(storage.s.blockCooldownUntil,T+2000+BLOCK_COOLDOWN_MS,'a stopped run still starts the cooldown');
 const msg=p.doc.bar().querySelector('.whospost-blockbar-msg').textContent;
 assert.match(msg,/^Threads 版面已變，請自己按（停在：「⋯」選單裡找不到「封鎖」）/);
});

test('profile tab: the switch turned off after the press → nothing is clicked, the bar says the helper is paused',async()=>{
 for(const flags of [{block:false,fetchedAt:T},null]){
  const storage=fakeStorage({blockIntent:{username:'abc',h:H,at:T},flags});let ran=0;
  const p=page('/@abc',storage,async()=>{ran++;});
  assert.deepEqual(await p.go(),{ok:false,step:'off'});
  assert.equal(ran,0);assert.equal(storage.s.blockIntent,null);assert.deepEqual(storage.s.blocked,{});
  assert.equal(p.doc.bar().dataset.whospostBlock,'off');
 }
});

test('wording: says whose decision it is, never judges the account',()=>{
 assert.equal(BLOCK_NOTE,'封鎖是你的決定，Whospost 只替你點，不判定任何人。');
 for(const k of ['running','blocked','already','stopped','off']){const t=blockBarText(k,{username:'abc',reason:'x'});assert.ok(t);assert.equal(/網軍|假帳號|機器人|判定為/.test(t),false,k);}
});
