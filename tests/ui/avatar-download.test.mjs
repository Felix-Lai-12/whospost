import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {avatarUrl,avatarFileName,avatarState,isWebView,pickMethod,downloadAvatar} from '../../frontend/src/avatar-download.mjs';

const src=f=>readFileSync(new URL(`../../frontend/src/${f}`,import.meta.url),'utf8');
const PNG=new Uint8Array([0x89,0x50,0x4e,0x47]);
const okResponse=(version='abcd1234')=>new Response(PNG,{status:200,headers:{'content-type':'image/png',...(version?{'x-avatar-version':version}:{})}});
function browser({share,canShare=()=>true,ua='Mozilla/5.0 (Macintosh) Chrome/130 Safari/537.36',open=()=>({}),response=okResponse()}={}){
 const log=[];
 const anchor={click(){log.push(`click:${anchor.download}:${anchor.href}`)},remove(){log.push('remove')}};
 const win={URL:{createObjectURL:()=>{log.push('objectURL');return 'blob:x'},revokeObjectURL:()=>log.push('revoke')},setTimeout:fn=>{fn()},open:(url,target)=>{log.push(`open:${url}:${target}`);return open(url)},location:{assign:url=>log.push(`assign:${url}`)}};
 const doc={createElement:()=>anchor,body:{appendChild:()=>log.push('append')}};
 const nav={...(share?{share:async files=>{log.push(`share:${files.files[0].name}`);return share(files)}}:{}),canShare};
 return {log,run:()=>downloadAvatar({url:'https://whospost.example/api/avatar/id.png',fileName:'whospost-@x.png',fetchImpl:async(url,init)=>{log.push(`fetch:${url}:${init.cache}`);return typeof response==='function'?response():response},nav,win,doc,ua})};
}

test('URL, file name and GA state are derived without leaking anything extra',()=>{
 assert.equal(avatarUrl('https://whospost.example','abc 1'),'https://whospost.example/api/avatar/abc%201.png');
 assert.equal(avatarFileName('hkj315'),'whospost-@hkj315.png');
 assert.equal(avatarFileName('we/ird name'),'whospost-@we_ird_name.png');
 assert.equal(avatarFileName(undefined),'whospost-@account.png');
 assert.equal(avatarState({value:3}),'scored');assert.equal(avatarState({value:0}),'scored');
 assert.equal(avatarState({value:null}),'unscored');assert.equal(avatarState(undefined),'unscored');
});

test('in-app browsers are told apart from Safari and Chrome',()=>{
 const ios='Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)';
 assert.equal(isWebView(`${ios} Version/17.5 Mobile/15E148 Safari/604.1`),false,'iOS Safari');
 assert.equal(isWebView(`${ios} Mobile/15E148`),true,'WKWebView has no Safari token');
 assert.equal(isWebView(`${ios} Mobile/15E148 Barcelona 300.0.0.0`),true,'Threads app');
 assert.equal(isWebView('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36'),false,'Android Chrome');
 assert.equal(isWebView('Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36'),true,'Android WebView');
 assert.equal(isWebView('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36 Instagram 300.0'),true);
 assert.equal(isWebView(''),false);
 assert.deepEqual([pickMethod({canShare:true,webView:true}),pickMethod({canShare:false,webView:true}),pickMethod({canShare:false,webView:false})],['share','open','download']);
});

test('share sheet first: a completed or dismissed sheet both count as success; a failed sheet opens the image instead',async()=>{
 const shared=browser({share:async()=>{}});
 assert.deepEqual(await shared.run(),{result:'success',method:'share',openUrl:'https://whospost.example/api/avatar/id.png?v=abcd1234'});
 assert.deepEqual(shared.log,['fetch:https://whospost.example/api/avatar/id.png:no-store','share:whospost-@x.png']);
 const dismissed=browser({share:async()=>{throw Object.assign(new Error('cancel'),{name:'AbortError'})}});
 assert.equal((await dismissed.run()).result,'success');
 const failed=browser({share:async()=>{throw new Error('NotAllowedError')}});
 const outcome=await failed.run();
 assert.deepEqual([outcome.result,outcome.method],['success','open']);
 assert.ok(failed.log.includes('open:https://whospost.example/api/avatar/id.png?v=abcd1234:_blank'));
});

test('without a share sheet: desktop gets a download link, in-app browsers get the image opened for a long press',async()=>{
 const desktop=browser({canShare:()=>false});
 assert.deepEqual(await desktop.run(),{result:'success',method:'download',openUrl:'https://whospost.example/api/avatar/id.png?v=abcd1234'});
 assert.deepEqual(desktop.log.slice(1),['objectURL','append','click:whospost-@x.png:blob:x','remove','revoke']);
 const threads=browser({canShare:()=>{throw new TypeError('no files')},ua:'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Mobile/15E148 Barcelona 300.0'});
 assert.equal((await threads.run()).method,'open');
 assert.ok(threads.log.includes('open:https://whospost.example/api/avatar/id.png?v=abcd1234:_blank'));
 const blocked=browser({canShare:()=>false,ua:'Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36',open:()=>null});
 await blocked.run();
 assert.ok(blocked.log.includes('assign:https://whospost.example/api/avatar/id.png?v=abcd1234'),'a blocked popup navigates the page to the image');
 const unversioned=browser({canShare:()=>false,response:okResponse(null)});
 assert.equal((await unversioned.run()).openUrl,'https://whospost.example/api/avatar/id.png');
});

test('a failed fetch reports fail with a link the visitor can still open by hand',async()=>{
 const missing=browser({response:()=>Response.json({error:'x'},{status:404})});
 const outcome=await missing.run();
 assert.deepEqual([outcome.result,outcome.method,outcome.openUrl,outcome.error.status],['fail',undefined,'https://whospost.example/api/avatar/id.png',404]);
 const offline=browser({response:()=>{throw new TypeError('Failed to fetch')}});
 assert.equal((await offline.run()).result,'fail');
});

test('the result page wires the button to the helper and sends only result, state and method to GA',()=>{
 const page=src('ShareResult.jsx');
 assert.match(page,/下載專屬頭貼/);
 assert.match(page,/analytics\.track\('avatar_download',method\?\{result,state,method\}:\{result,state\}\)/);
 assert.ok(!/avatar_download[^\n]*username|avatar_download[^\n]*scan\.id/.test(page),'no account or scan ID in the event');
 assert.match(page,/正在準備圖片…/,'the first render can take a second or two, so the button says so');
 assert.match(page,/點這裡開啟圖片/,'the failure notice keeps a manual way to the image');
 assert.match(src('style.css'),/\.cta-button\.cta-secondary/);
});
