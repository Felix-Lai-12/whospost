import test from 'node:test';
import assert from 'node:assert/strict';
import {prefilledInput} from '../../frontend/src/prefill-model.mjs';
import {createAnalytics,pageLocation} from '../../frontend/src/analytics.mjs';

const memory=()=>{const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,String(v))};};
const page=(search='')=>{const head=[];return {head,win:{location:{origin:'https://whospost.example',pathname:'/',search}},doc:{head:{appendChild:n=>head.push(n)},createElement:()=>({})}};};
const calls=win=>(win.dataLayer??[]).map(a=>[...a]);

test('?u= fills the search box as an @handle from a handle, a bare name or a profile link, and nothing else',()=>{
 assert.equal(prefilledInput('?u=%40Some_User&from=ext'),'@some_user');
 assert.equal(prefilledInput('?u=some.user'),'@some.user');
 assert.equal(prefilledInput(`?u=${encodeURIComponent('https://www.threads.com/@Some_User/')}`),'@some_user');
 assert.equal(prefilledInput(`?u=${encodeURIComponent('threads.net/@abc')}`),'@abc');
 for(const bad of ['','?scan=abc','?u=','?u=not%20valid','?u=%3Cscript%3E',`?u=${encodeURIComponent('https://evil.example/@abc')}`,`?u=${'a'.repeat(40)}`])assert.equal(prefilledInput(bad),'',bad||'(empty)');
});

test('from=ext becomes entry_source while the pre-filled username never reaches GA',()=>{
 const {win,doc}=page('?u=some_user&from=ext'),a=createAnalytics({win,doc,storage:memory(),search:'?u=some_user&from=ext'});
 a.init('G-TEST1234');a.track('scan_submit',{input_type:'handle',outcome:'started'});
 const config=calls(win).find(c=>c[0]==='config'),event=calls(win).find(c=>c[0]==='event');
 assert.equal(config[2].page_location,'https://whospost.example/','neither u nor from is sent as the page address');
 assert.deepEqual(event.slice(1),['scan_submit',{page_type:'home',entry_source:'ext',input_type:'handle',outcome:'started'}]);
 assert.equal(JSON.stringify(calls(win)).includes('some_user'),false);
 assert.equal(pageLocation({origin:'https://whospost.example',pathname:'/',search:'?u=some_user&from=ext&utm_source=ext'}),'https://whospost.example/?utm_source=ext');
});
