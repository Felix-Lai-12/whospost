import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {voteConfig,countdownView,countdownText,countdownAria,DEFAULT_VOTE_OPEN_MS} from '../../frontend/src/countdown-model.mjs';
import {readPledge,ensureToken,submitPledge,formatCount,PLEDGE_KEY} from '../../frontend/src/pledge-model.mjs';

const src=f=>readFileSync(new URL(`../../frontend/src/${f}`,import.meta.url),'utf8');
const memory=()=>{const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k),size:()=>m.size};};
const fake=()=>{const sent=[];return {sent,track:(n,p)=>sent.push([n,p])};};
const H=3600000,OPEN=DEFAULT_VOTE_OPEN_MS;

test('the default target is 2026-11-28 08:00 Taipei, which is midnight UTC',()=>{
 assert.equal(new Date(OPEN).toISOString(),'2026-11-28T00:00:00.000Z');
 const c=voteConfig({});
 assert.deepEqual(c,{enabled:true,openMs:OPEN,closeMs:OPEN+8*H,hideMs:OPEN+16*H});
});

test('countdown phases: before, election-day morning, open, closed, hidden',()=>{
 const before=countdownView(Date.UTC(2026,9,21,2,47,15));
 assert.deepEqual(before,{phase:'before',today:false,days:37,hours:21,minutes:12,seconds:45,clock:'21:12:45'});
 assert.deepEqual(countdownText(before),{label:'11/28 投票日還有',value:'37 天 21:12:45'});
 assert.equal(countdownAria(before),'距 11 月 28 日投票日還有 37 天 21 小時 12 分');
 // 11/27 23:59:59 Taipei: still the day before, 8 h to go, so the election-day wording applies.
 const eve=countdownView(OPEN-8*H-1000);
 assert.deepEqual([eve.phase,eve.today,eve.days,eve.clock],['before',false,0,'08:00:01']);
 const morning=countdownView(OPEN-8*H);
 assert.deepEqual([morning.phase,morning.today,morning.clock],['before',true,'08:00:00']);
 assert.deepEqual(countdownText(morning),{label:'今天投票日',value:'08:00:00 後開門'});
 assert.deepEqual(countdownView(OPEN-1000),{phase:'before',today:true,days:0,hours:0,minutes:0,seconds:1,clock:'00:00:01'});
 assert.deepEqual(countdownView(OPEN),{phase:'open'});
 assert.deepEqual(countdownText(countdownView(OPEN+7*H+59*60000)),{label:'今天投票日',value:'投票所開到 16:00'});
 assert.deepEqual(countdownView(OPEN+8*H),{phase:'closed'});
 assert.deepEqual(countdownText(countdownView(OPEN+15*H)),{label:'投票結束',value:null});
 assert.deepEqual(countdownView(OPEN+16*H),{phase:'hidden'},'gone from 11/29 00:00 Taipei');
 assert.deepEqual(countdownView(OPEN+400*24*H),{phase:'hidden'});
 assert.equal(countdownAria(countdownView(OPEN+1)),'今天投票日，投票所開到 16:00');
});

test('build overrides: VITE_VOTE_OPEN_AT moves the target, VITE_VOTE_COUNTDOWN=0 hides everything, junk is ignored',()=>{
 const moved=voteConfig({VITE_VOTE_OPEN_AT:'2027-01-09T08:00:00+08:00'});
 assert.equal(moved.openMs,Date.UTC(2027,0,9,0));assert.equal(moved.hideMs,moved.openMs+16*H);
 assert.equal(countdownView(Date.UTC(2027,0,8,0),moved).days,1);
 assert.equal(voteConfig({VITE_VOTE_OPEN_AT:'not a date'}).openMs,OPEN);
 assert.equal(voteConfig({VITE_VOTE_OPEN_AT:'   '}).openMs,OPEN);
 for(const env of [{VITE_VOTE_COUNTDOWN:'0'},{VITE_VOTE_COUNTDOWN:' 0 '}]){assert.equal(voteConfig(env).enabled,false);assert.deepEqual(countdownView(Date.UTC(2026,0,1),voteConfig(env)),{phase:'hidden'});}
 assert.equal(voteConfig({VITE_VOTE_COUNTDOWN:'1'}).enabled,true);
});

test('pledge storage: no storage never throws; one token per browser even when clicked twice; junk is dropped',()=>{
 assert.equal(readPledge(null),null);
 assert.match(ensureToken(null,()=>'0f3b2a9c-1d2e-4f50-8a6b-7c8d9e0f1a2b'),/^[a-f0-9]{32}$/);
 const broken={getItem(){throw Error('blocked')},setItem(){throw Error('blocked')}};
 assert.equal(readPledge(broken),null);assert.equal(ensureToken(broken).length,32);
 const s=memory();
 const a=ensureToken(s),b=ensureToken(s,()=>'ffffffff-ffff-ffff-ffff-ffffffffffff');
 assert.equal(a,b,'the second click reuses the saved token');
 assert.deepEqual(readPledge(s),{token:a,counted:false,at:null});
 for(const junk of ['{','[]','{"token":"zz"}','{"token":"ABCDEF0123456789ABCDEF0123456789"}','{"token":"'+'a'.repeat(31)+'"}']){const t=memory();t.setItem(PLEDGE_KEY,junk);assert.equal(readPledge(t),null,junk);}
 assert.equal(formatCount(1234),'1,234');assert.equal(formatCount(0),'0');
});

test('submitPledge: counted and already mark the device done and send pledge_click with only result',async()=>{
 for(const result of ['counted','already']){
  const s=memory(),a=fake(),calls=[];
  const fetchImpl=async(url,init)=>{calls.push([url,init.method,init.headers['Content-Type'],JSON.parse(init.body)]);return Response.json({result,count:1235});};
  const out=await submitPledge({storage:s,fetchImpl,analytics:a,now:()=>'2026-10-21T00:00:00.000Z'});
  assert.deepEqual(out,{status:result,count:1235});
  assert.deepEqual(calls.length,1);assert.deepEqual(calls[0].slice(0,3),['/api/pledge','POST','application/json']);
  assert.deepEqual(Object.keys(calls[0][3]),['token']);
  assert.deepEqual(readPledge(s),{token:calls[0][3].token,counted:true,at:'2026-10-21T00:00:00.000Z'});
  assert.deepEqual(a.sent,[['pledge_click',{result}]]);
 }
});

test('submitPledge: 429, server errors and network failures keep the token, stay uncounted and send nothing',async()=>{
 const cases=[[async()=>Response.json({code:'RATE_LIMITED',error:'x',count:9},{status:429}),'rate_limited',9],[async()=>new Response('boom',{status:500}),'error',null],[async()=>{throw Error('offline')},'error',null],[async()=>Response.json({result:'weird',count:3}),'error',3]];
 for(const [fetchImpl,status,count] of cases){
  const s=memory(),a=fake();
  const before=ensureToken(s);
  assert.deepEqual(await submitPledge({storage:s,fetchImpl,analytics:a}),{status,count});
  assert.deepEqual(readPledge(s),{token:before,counted:false,at:null});
  assert.deepEqual(a.sent,[]);
 }
});

test('the strip is a <section> outside the nav, is a button not a link, sends no nav_click and names no candidate or party',()=>{
 const jsx=src('VoteStrip.jsx'),main=src('main.jsx'),model=src('countdown-model.mjs');
 assert.match(jsx,/<section className="vote-strip" aria-label="投票倒數">/);
 assert.match(jsx,/<button type="button"/);assert.match(jsx,/pledged\?<p className="vote-done" role="status">/,'after pledging the button gives way to the count text');assert.match(jsx,/text:'已登記'/,'a toast confirms the pledge');assert.doesNotMatch(jsx,/nav_click|<a |href=/);
 assert.match(jsx,/role="timer"/);assert.doesNotMatch(jsx,/aria-live="(assertive|polite)"[^>]*vote-countdown/,'the timer itself is never live');
 assert.match(jsx,/visibilitychange/,'the interval stops in a hidden tab');
 assert.doesNotMatch(jsx,/createElement\('script'\)|<script|https?:\/\//,'no remote resource');
 assert.match(main,/<\/div><VoteStrip\/><div className="header-actions">/,'between the branding and the nav buttons');
 for(const word of ['候選人','政黨','號次','民進黨','國民黨','民眾黨','投給','支持','藍','綠','白'])for(const [name,text] of [['VoteStrip.jsx',jsx],['countdown-model.mjs',model]])assert.equal(text.includes(word),false,`${name} mentions ${word}`);
 assert.match(src('pledge-model.mjs'),/'pledge_click',\{result:data\.result\}/,'the only GA param is result');
});

test('README documents the variables, the event and the one-per-browser rule',()=>{
 const readme=readFileSync(new URL('../../README.md',import.meta.url),'utf8');
 for(const key of ['`VITE_VOTE_OPEN_AT`','`VITE_VOTE_COUNTDOWN`','`WHOSPOST_PLEDGE_GLOBAL_PER_MIN`','`pledge_click`','同一瀏覽器只算一次','不是統計資料'])assert.ok(readme.includes(key),key);
 const env=readFileSync(new URL('../../frontend/.env.example',import.meta.url),'utf8');
 assert.match(env,/VITE_VOTE_OPEN_AT=/);assert.match(env,/VITE_VOTE_COUNTDOWN=/);
});
