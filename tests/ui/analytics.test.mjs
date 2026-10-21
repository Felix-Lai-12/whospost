import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createAnalytics,scanOutcome,inputType,pageLocation} from '../../frontend/src/analytics.mjs';

const memory=()=>{const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,String(v))};};
const page=(search='')=>{const head=[];return {head,win:{location:{origin:'https://whospost.example',pathname:'/',search}},doc:{head:{appendChild:n=>head.push(n)},createElement:()=>({})}};};
const events=win=>(win.dataLayer??[]).map(a=>[...a]).filter(a=>a[0]==='event').map(a=>[a[1],a[2]]);

test('without a valid Measurement ID nothing loads and nothing is sent',()=>{
 for(const id of [null,undefined,'','UA-123','G-abc','G-12345<script>']){
  const {win,doc,head}=page(),a=createAnalytics({win,doc,storage:memory()});
  a.track('scan_submit',{outcome:'started'});a.init(id);a.track('share_copy',{result:'success'});
  assert.equal(win.dataLayer,undefined);assert.equal(head.length,0);assert.equal(a.enabled,false);
 }
});

test('a valid ID loads gtag once, flushes queued events and adds the common params',()=>{
 const {win,doc,head}=page('?scan=abc&from=share&utm_source=line'),a=createAnalytics({win,doc,storage:memory(),search:'?scan=abc&from=share'});
 a.track('search_input',{method:'paste'});
 a.init('G-TEST1234');a.init('G-OTHER999');
 a.setPageType('result');a.track('share_copy',{result:'success'});
 assert.equal(head.length,1);assert.equal(head[0].src,'https://www.googletagmanager.com/gtag/js?id=G-TEST1234');
 const config=[...win.dataLayer[1]];
 assert.deepEqual(config,['config','G-TEST1234',{page_location:'https://whospost.example/?utm_source=line'}],'the shared scan ID never reaches page_location');
 assert.deepEqual(events(win),[
  ['search_input',{page_type:'home',entry_source:'share',method:'paste'}],
  ['share_copy',{page_type:'result',entry_source:'share',result:'success'}]
 ]);
});

test('entry_source keeps only the first landing and only whitelisted values',()=>{
 const storage=memory();
 createAnalytics({storage,search:'?from=share'});
 const {win,doc}=page(),later=createAnalytics({win,doc,storage,search:'?from=newsletter'});
 later.init('G-TEST1234');later.track('nav_click',{item:'github'});
 assert.equal(events(win)[0][1].entry_source,'share');
 for(const from of ['Share','a b','x'.repeat(33),'<script>']){
  const p=page(),a=createAnalytics({...p,storage:memory(),search:`?from=${encodeURIComponent(from)}`});a.init('G-TEST1234');a.track('nav_click',{item:'sponsor'});
  assert.equal('entry_source' in events(p.win)[0][1],false,from);
 }
});

test('trackOnce sends once per browser session and storage failures never throw',()=>{
 const storage=memory(),{win,doc}=page(),a=createAnalytics({win,doc,storage});a.init('G-TEST1234');
 a.trackOnce('search_input','search_input',{method:'type'});a.trackOnce('search_input','search_input',{method:'paste'});
 const again=createAnalytics({win,doc,storage});again.init('G-TEST1234');again.trackOnce('search_input','search_input',{method:'type'});
 assert.equal(events(win).filter(e=>e[0]==='search_input').length,1);
 const broken={getItem(){throw Error('blocked')},setItem(){throw Error('blocked')}};
 const p=page(),b=createAnalytics({...p,storage:broken,search:'?from=share'});
 assert.doesNotThrow(()=>{b.init('G-TEST1234');b.trackOnce('k','app_error',{kind:'poll'});b.trackOnce('k','app_error',{kind:'poll'});});
 assert.equal(events(p.win).length,1);
 const failing=createAnalytics({win:{location:page().win.location,set gtag(f){},get gtag(){throw Error('gtag broke')}},doc:page().doc,storage:memory()});
 assert.doesNotThrow(()=>{failing.init('G-TEST1234');failing.track('share_copy',{result:'fail'});});
});

test('scan_submit outcome follows the API answer',()=>{
 assert.deepEqual([[202],[200],[429,'RATE_LIMITED'],[429,'DAILY_QUOTA'],[429,'DAILY_BUDGET_EXCEEDED'],[403,'TURNSTILE_FAILED'],[503,'SCANS_PAUSED'],[503,'BUDGET_EXCEEDED'],[409,'COLLECTION_PROFILE_MISMATCH'],[500]].map(([s,c])=>scanOutcome(s,c)),
  ['started','cached','rate_limited','quota','quota','turnstile_failed','paused','paused','error','error']);
});

test('input_type tells links, @handles and bare usernames apart',()=>{
 assert.deepEqual(['https://www.threads.com/@sample','threads.net/@sample','@sample','sample','sample._.61',' @sample '].map(inputType),['link','link','handle','bare','bare','handle']);
});

test('page_location keeps only utm parameters',()=>{
 assert.equal(pageLocation({origin:'https://w.example',pathname:'/',search:'?scan=abc&from=share&utm_source=x&utm_medium=y'}),'https://w.example/?utm_source=x&utm_medium=y');
 assert.equal(pageLocation({origin:'https://w.example',pathname:'/',search:'?scan=abc'}),'https://w.example/');
});

test('the frontend sends only enumerated params, never the account, scan ID or URL',()=>{
 const sources=['main.jsx','ShareResult.jsx','AiBehavior.jsx','Sponsor.jsx','sponsor-model.mjs'].map(f=>readFileSync(new URL(`../../frontend/src/${f}`,import.meta.url),'utf8')).join('\n');
 // trackOnce's first argument is a local dedup key that is never sent, so only the event name and params are checked.
 const calls=[...sources.matchAll(/analytics\.track(Once)?\(([^;]*?)\)(?=[;}])/g)].map(m=>m[1]?m[2].replace(/^(`[^`]*`|'[^']*'),/,''):m[2]);
 assert.ok(calls.length>=10,`found ${calls.length} tracking calls`);
 const allowed=new Set(['method','input_type','outcome','cached','signals','result','item','kind','slot','campaign']);
 for(const call of calls){
  const keys=[...call.matchAll(/[{,]\s*([a-z_]+)(?=[:,}])/g)].map(m=>m[1]);
  for(const key of keys)assert.ok(allowed.has(key),`${key} in ${call}`);
  assert.doesNotMatch(call,/username|account|url|email|scan\.id/i,call);
 }
});

test('CSP lets gtag load and send',()=>{
 const csp=readFileSync(new URL('../../frontend/public/_headers',import.meta.url),'utf8');
 assert.match(csp,/script-src [^;]*https:\/\/www\.googletagmanager\.com/);
 assert.match(csp,/connect-src [^;]*https:\/\/\*\.google-analytics\.com/);
});

test('the search form points at "/" so GA form events never carry a shared scan ID',()=>{
 const main=readFileSync(new URL('../../frontend/src/main.jsx',import.meta.url),'utf8');
 assert.match(main,/<form action="\/" onSubmit=\{submit\}/);
});
