import test from 'node:test';
import assert from 'node:assert/strict';
import {allowance,recordStart,emptyUsage,startOutcome,liveEntry,liveFromView,pollDelay,pruneResults,withResult,taipeiTime,validUsername,validScanId,HOURLY_LIMIT,HOUR_MS,POLL_MS,POLL_SLOW_MS,POLL_MAX_MS,LIVE_TTL_MS,STATUSES} from '../../extension/lib/live.mjs';
import {chipText,popoverModel,toastText,QUICK_NOTE} from '../../extension/lib/label.mjs';
// 即時查 (EXTENSION-SPEC §4.3): the pure parts of the flow the engine and the background script run.
const H='c'.repeat(64),ID='0f1e2d3c-4b5a-4968-8776-655443322110';
const NOON=Date.UTC(2026,9,23,4,0,0);
const items=(...yes)=>['content-posts','content-comments','author-focus','thread-focus','mutual-focus','burst-replies'].map(id=>({id,status:yes.includes(id)?'yes':id==='mutual-focus'?'unknown':'no'}));

test('hourly allowance: ten starts an hour per installation, counted locally; the eleventh waits for the oldest to age out',()=>{
 assert.equal(HOURLY_LIMIT,10);assert.equal(STATUSES.join(),'scanning,partial,done,failed');
 let usage=emptyUsage();
 assert.deepEqual(allowance(usage,NOON),{allowed:true,remaining:10,limit:10,retryAt:null});
 for(let i=0;i<10;i++)usage=recordStart(usage,NOON+i*60000);
 const full=allowance(usage,NOON+10*60000);
 assert.equal(full.allowed,false);assert.equal(full.remaining,0);assert.equal(full.retryAt,NOON+HOUR_MS,'when the oldest start leaves the window');
 assert.equal(allowance(usage,NOON+HOUR_MS+1).remaining,1,'one slot back after an hour');
 assert.equal(allowance(usage,NOON+2*HOUR_MS).remaining,10);
 assert.equal(recordStart(usage,NOON+2*HOUR_MS).stamps.length,1,'old stamps are dropped on write');
 assert.equal(allowance({stamps:['x',null,NOON+HOUR_MS*5]},NOON).remaining,10,'junk and future stamps are ignored');
 assert.equal(allowance(null,NOON).allowed,true);
 assert.equal(taipeiTime(NOON),'12:00');
});

test('startOutcome: 202 starts, 200 is a saved result, every refusal keeps its code and a short reason; 403 is the whitelist, not Turnstile',()=>{
 assert.deepEqual(startOutcome(202,{id:ID,status:'queued'}),{ok:true,scanId:ID,status:'queued',cached:false});
 assert.deepEqual(startOutcome(200,{id:ID,status:'completed',cached:true}),{ok:true,scanId:ID,status:'completed',cached:true});
 assert.deepEqual(startOutcome(429,{code:'DAILY_QUOTA',error:'每個網路位置每天最多 3 次新查詢'}),{ok:false,code:'DAILY_QUOTA',message:'今天的即時查次數用完了'});
 assert.equal(startOutcome(429,{code:'RATE_LIMITED'}).message,'請求太頻繁，一分鐘後再試');
 // The extension channel's own cross-IP ceiling: a plain failure the user may retry, not the local hourly allowance.
 assert.deepEqual(startOutcome(429,{code:'EXTENSION_RATE_LIMITED',error:'即時查太頻繁，請稍後再試。'}),{ok:false,code:'EXTENSION_RATE_LIMITED',message:'即時查太頻繁，請稍後再試'});
 assert.equal(startOutcome(503,{code:'EXTENSION_NOT_CONFIGURED'}).message,'這個站還沒開即時查');
 assert.equal(startOutcome(503,{code:'SCANS_PAUSED',error:'新查詢暫停中；…'}).message,'新查詢暫停中');
 assert.deepEqual(startOutcome(403,{error:'不接受外部網站啟動查詢'}),{ok:false,code:'EXTENSION_NOT_ALLOWED',message:'這個版本還不能即時查'});
 assert.deepEqual(startOutcome(0,null),{ok:false,code:'NETWORK',message:'連不上 Whospost'});
 assert.equal(startOutcome(500,{error:'服務暫時無法回應'}).code,'HTTP_500');assert.equal(startOutcome(500,{error:'服務暫時無法回應'}).message,'服務暫時無法回應');
 assert.equal(startOutcome(202,{id:'not-an-id'}).ok,false,'a malformed id is not a start');
 assert.equal(validUsername('zuck'),true);assert.equal(validUsername('a b'),false);assert.equal(validScanId(ID),true);assert.equal(validScanId('x'),false);
});

test('liveFromView keeps the three answers apart: scanning (nothing yet), partial (快篩, marked), done (a list-shaped entry), failed (no entry at all)',()=>{
 const scanning=liveFromView({id:ID,status:'running',progress:'取得公開發文與留言',score:{value:null,assessed:0,unknown:6,items:items()}},{h:H,now:NOON});
 assert.deepEqual(scanning,{status:'scanning',scanId:ID,progress:'取得公開發文與留言',at:NOON});
 assert.equal(liveFromView({id:ID,status:'queued'},{h:H,now:NOON}).status,'scanning');
 const partial=liveFromView({id:ID,status:'running',progress:'x',quick:{partial:true,at:'2026-10-23T04:00:10Z',posts:10,comments:9,score:{value:2,assessed:4,unknown:2,hits:['content-comments','thread-focus']}}},{h:H,now:NOON});
 assert.equal(partial.status,'partial');assert.equal(partial.comments,9);assert.equal(partial.posts,10);
 assert.deepEqual(partial.entry,{h:H,score:2,hits:['content-comments','thread-focus'],assessed:4,unknown:2,evidence:'rules',ai:null,scanId:ID,updated:'2026-10-23T04:00:10Z',appeals:0,live:true,partial:true});
 const done=liveFromView({id:ID,status:'completed',completedAt:'2026-10-23T04:01:00Z',score:{value:4,assessed:5,unknown:1,items:items('content-comments','thread-focus','author-focus','burst-replies')}},{h:H,now:NOON});
 assert.equal(done.status,'done');assert.deepEqual(done.entry,{h:H,score:4,hits:['content-comments','author-focus','thread-focus','burst-replies'],assessed:5,unknown:1,evidence:'rules',ai:null,scanId:ID,updated:'2026-10-23T04:01:00Z',appeals:0,live:true,partial:false});
 const clean=liveFromView({id:ID,status:'completed',completedAt:'2026-10-23T04:01:00Z',score:{value:0,assessed:6,unknown:0,items:items()}},{h:H});
 assert.equal(clean.entry.score,0);assert.equal(clean.entry.evidence,null);
 const thin=liveFromView({id:ID,status:'completed',score:{value:null,assessed:0,unknown:6,items:items()}},{h:H});
 assert.equal(thin.entry.score,null,'checked but nothing assessable stays null, never 0');
 const failed=liveFromView({id:ID,status:'failed',error:{code:'PROVIDER_FAILED',message:'取數失敗，未取得可分析資料。'}},{h:H,now:NOON});
 assert.deepEqual(failed,{status:'failed',code:'PROVIDER_FAILED',message:'取數失敗，未取得可分析資料。',scanId:ID,at:NOON});
 assert.equal('entry' in failed,false,'a failure carries no entry, so it can never be drawn as 0 hits');
 assert.equal(liveFromView(null,{h:H}).status,'failed');assert.equal(liveFromView({status:'weird'},{h:H}).code,'BAD_VIEW');
 assert.equal(liveEntry({h:H,scanId:ID,score:null}).unknown,6);
});

test('polling: 2 s for the first half minute, then 3 s, and stops after four minutes',()=>{
 assert.equal(pollDelay(0),POLL_MS);assert.equal(pollDelay(29000),2000);assert.equal(pollDelay(31000),POLL_SLOW_MS);assert.equal(pollDelay(POLL_MAX_MS-1),3000);assert.equal(pollDelay(POLL_MAX_MS),null);
});

test('finished results are kept locally for an hour by account hash; junk and stale ones are pruned',()=>{
 const entry={score:4,hits:['content-comments'],assessed:5,unknown:1,evidence:'rules',ai:null,scanId:ID,updated:null,appeals:0,live:true,partial:false};
 const saved=withResult(null,H,entry,NOON);
 assert.deepEqual(saved,{[H]:{entry:{...entry,h:H},at:NOON}});
 assert.deepEqual(pruneResults(saved,NOON+LIVE_TTL_MS-1),saved);assert.deepEqual(pruneResults(saved,NOON+LIVE_TTL_MS),{});
 assert.deepEqual(pruneResults({...saved,bad:{entry,at:NOON},[('d').repeat(64)]:{at:NOON},[('e').repeat(64)]:'x'},NOON),saved);
 assert.equal(Object.keys(withResult(saved,'f'.repeat(64),entry,NOON+LIVE_TTL_MS)).length,1,'adding one prunes the rest');
});

test('wording: the busy chip, the 快篩 chip (never folded), the finished chip with「查過、沒線索」, the popover notes and the toasts',()=>{
 assert.deepEqual(chipText({live:{status:'scanning'}}),{text:'查詢中…',tone:'grey',busy:true});
 assert.equal(chipText({live:{status:'failed'}}),null,'a failure draws nothing: the account is still not checked');
 const partial={h:H,score:2,hits:['content-comments','thread-focus'],assessed:4,unknown:2,evidence:'rules',ai:null,scanId:ID,updated:null,appeals:0,live:true,partial:true};
 assert.deepEqual(chipText({entry:partial}),{text:'快篩 2 項符合',tone:'grey',partial:true},'the status words, used only when there are no reason chips to show');
 assert.deepEqual(chipText({entry:{...partial,score:3}}),{text:'快篩 3 項符合',tone:'orange',partial:true});
 assert.deepEqual(chipText({entry:{...partial,score:0,hits:[]}}),{text:'快篩 目前沒線索',tone:'grey',partial:true});
 assert.deepEqual(chipText({entry:{...partial,score:null}}),{text:'快篩 資料還不夠',tone:'grey',partial:true});
 const done={...partial,partial:false,score:4,hits:['content-comments','author-focus','thread-focus','burst-replies'],assessed:5,unknown:1};
 assert.deepEqual(chipText({entry:done}),{text:'6 項中 4 項符合',tone:'orange'});
 assert.deepEqual(chipText({entry:{...done,score:0,hits:[]}}),{text:'暫無疑慮',tone:'clear'});
 assert.deepEqual(chipText({entry:{...done,score:null,hits:[]}}),{text:'查過、資料不足',tone:'grey'});
 assert.deepEqual(chipText({entry:done,trusted:true}),{text:'已信任',tone:'green'});
 const p=popoverModel({username:'u8',entry:partial,live:{status:'partial',comments:9,posts:10}});
 assert.equal(p.title,'@u8 · 快篩','the 快篩 title marks the pass as not final; the reason chips sit beside it (Felix 10-26)');assert.equal(p.line,QUICK_NOTE({comments:9,posts:10}));assert.match(p.line,/只看了最近 10 篇貼文與 9 則留言/);
 assert.deepEqual(p.secondary,{label:'看目前證據',href:`https://whospost.felixlai.workers.dev/?scan=${ID}&from=ext`});
 const d=popoverModel({username:'u8',entry:done});
 assert.equal(d.line,null,'a finished check shows no counts line in the popover (Felix 10-24)');assert.equal(d.secondary.label,'看完整證據');assert.equal(d.site,null);
 assert.deepEqual(popoverModel({username:'u8',live:{status:'scanning'}}).secondary,{action:'none',label:'查詢中…'});
 assert.equal(toastText('liveStarted',{username:'u8'}),'正在查 @u8，你可以繼續往下滑');
 assert.equal(toastText('liveDone',{username:'u8'}),'@u8 查好了');
 assert.equal(toastText('liveFailed',{username:'u8',reason:'連不上 Whospost'}),'@u8 查詢失敗：連不上 Whospost');
 assert.equal(toastText('liveFailed',{username:'u8'}),'@u8 查詢失敗');
 assert.equal(toastText('liveLimit',{when:'13:05'}),'這小時的即時查用完了，13:05 後再試');
 assert.equal(toastText('liveTimeout',{username:'u8'}),'@u8 還沒查完；結果之後會進清單');
});
test('AI judgement of a finished 即時查 (Felix 10-26): cut like the list, pending while written, nothing when flagged',async()=>{
 const {aiFromResponse}=await import('../../extension/lib/live.mjs');
 const ready={status:'ready',account:'abc.def',result:{conclusion:'abc.def 在十分鐘內對 @someone 貼了 12 則相同回覆。其他看不出來。'},provenance:{model:'claude-sonnet-5-5'}};
 assert.deepEqual(aiFromResponse(ready),{ai:{summary:'該帳號 在十分鐘內對 該帳號 貼了 12 則相同回覆。',version:'claude-sonnet-5-5'}});
 for(const status of ['processing','not_requested','scan_not_ready'])assert.deepEqual(aiFromResponse({status}),{pending:true},status);
 for(const status of ['no_data','budget_exceeded','disabled','invalid_output'])assert.deepEqual(aiFromResponse({status}),{},status);
 assert.deepEqual(aiFromResponse({...ready,result:{...ready.result,policyWarnings:['x']}}),{},'the wording gate flagged it');
 assert.deepEqual(aiFromResponse(null),{});
});
