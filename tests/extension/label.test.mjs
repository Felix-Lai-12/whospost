import test from 'node:test';
import assert from 'node:assert/strict';
import {chipText,conclusion,reasonChips,popoverModel,stubText,pillText,toastText,pageSummary,checkUrl,scanUrl,shortDate,SIGNAL_LABELS,SIGNAL_IDS,SIGNAL_SHORT,SITE,PRIVACY_DELETION_URL,NOT_IDENTITY,THREAD_ONLY_NOTE,LIST_UNREADABLE} from '../../extension/lib/label.mjs';
import {signalScore} from '../../shared/signals.mjs';
import {threadVerdict} from '../../extension/lib/thread.mjs';
const entry={h:'a'.repeat(64),score:4,hits:['content-comments','thread-focus','author-focus','burst-replies'],assessed:5,unknown:1,evidence:'rules',ai:{summary:'該帳號的留言高度重複。',version:'g'},scanId:'abc def',updated:'2026-10-18T03:00:00Z',appeals:0};
const thread=threadVerdict({replies:7,sameContent:3});

test('the six rule labels are the site\'s own, read from signalScore, in its order; each has a short name',()=>{
 assert.deepEqual(SIGNAL_IDS,signalScore({}).items.map(i=>i.id));
 assert.deepEqual(SIGNAL_LABELS,Object.fromEntries(signalScore({}).items.map(i=>[i.id,i.label])));
 assert.deepEqual(Object.keys(SIGNAL_SHORT).sort(),[...SIGNAL_IDS].sort());
});

test('links open the site with from=ext, the username encoded; the deletion link is the privacy page anchor',()=>{
 assert.equal(SITE,'https://whospost.felixlai.workers.dev');
 assert.equal(checkUrl('Zuck'),'https://whospost.felixlai.workers.dev/?u=Zuck&from=ext');
 assert.equal(checkUrl('a&b'),'https://whospost.felixlai.workers.dev/?u=a%26b&from=ext');
 assert.equal(scanUrl('abc def'),'https://whospost.felixlai.workers.dev/?scan=abc%20def&from=ext');
 assert.equal(PRIVACY_DELETION_URL,'https://whospost.felixlai.workers.dev/privacy#deletion');
});

test('chip (§3 item 2): orange from fadeAt, grey below it, blue for thread observation only, green when trusted, none otherwise',()=>{
 assert.deepEqual(chipText({entry}),{text:'6 項中 4 項符合',tone:'orange'});
 assert.deepEqual(chipText({entry:{...entry,score:1}}),{text:'6 項中 1 項符合',tone:'grey'});
 assert.deepEqual(chipText({entry:{...entry,score:2},fadeAt:2}),{text:'6 項中 2 項符合',tone:'orange'});
 assert.deepEqual(chipText({thread}),{text:'本串 7 則',tone:'blue'});
 assert.deepEqual(chipText({thread:threadVerdict({replies:1,sameContent:3})}),{text:'3 個帳號貼同一段',tone:'blue'});
 assert.deepEqual(chipText({entry,thread}),{text:'6 項中 4 項符合',tone:'orange'},'the list wins the chip; the thread goes in the popover');
 assert.deepEqual(chipText({entry,trusted:true}),{text:'已信任',tone:'green'});
 assert.equal(chipText({}),null);assert.equal(chipText({entry:{...entry,score:null}}),null);
 for(const t of [chipText({entry}).text,chipText({thread}).text])assert.equal(/%|網軍|機率/.test(t),false,'no percentages, no verdict words');
});

test('the conclusion is one sentence from the strongest hit, in a fixed priority; nothing hit says so',()=>{
 assert.equal(conclusion(entry),'留言像機器在發');
 assert.equal(conclusion({...entry,hits:['thread-focus','author-focus']}),'在同一篇下狂留言');
 assert.equal(conclusion({...entry,hits:['burst-replies','thread-focus']}),'在同一篇下連發留言');
 assert.equal(conclusion({...entry,hits:['author-focus']}),'集中回覆同一個人');
 assert.equal(conclusion({...entry,hits:['mutual-focus']}),'和另一個帳號互相集中回覆');
 assert.equal(conclusion({...entry,hits:['content-posts']}),'貼文一再重複');
 assert.equal(conclusion({...entry,score:0,hits:[]}),'查過了，沒看到可疑行為');
 assert.equal(conclusion({...entry,score:null}),'');assert.equal(conclusion(null),'');
});

test('popover for a listed account (§3 item 4): title with the conclusion, reason chips in rule order, one line of numbers, disclaimer, trust + evidence',()=>{
 const m=popoverModel({username:'_randomdev001',entry});
 assert.equal(m.title,'@_randomdev001 · 留言像機器在發');
 assert.deepEqual(m.chips,['留言大量重複','同篇超過 10 次','半數以上給同一作者','10 秒內連留 3 次']);
 assert.equal(m.line,'6 項檢查中 4 項符合、1 項不符合、1 項資料不足。查於 10/18。');
 assert.equal(m.note,NOT_IDENTITY);
 assert.deepEqual(m.primary,{action:'trust',label:'信任這個帳號'});
 assert.deepEqual(m.secondary,{label:'看完整證據',href:scanUrl('abc def')});
 assert.equal(m.deletion.href,PRIVACY_DELETION_URL);
 assert.deepEqual(reasonChips({entry,thread}),['留言大量重複','同篇超過 10 次','半數以上給同一作者','10 秒內連留 3 次','本串 7 則','3 個帳號貼同一段']);
 const stale=popoverModel({username:'x',entry:{...entry,appeals:2},listStatus:'stale',generated:'2026-10-21T00:00:00Z'});
 assert.equal(stale.line,'6 項檢查中 4 項符合、1 項不符合、1 項資料不足。查於 10/18。清單 10/21 版。2 人按過信任。');
 assert.equal(popoverModel({username:'x',entry:{...entry,scanId:null}}).secondary.label,'用 Whospost 重新查詢');
 assert.equal(/%|網軍|機率/.test([m.title,...m.chips,m.line,m.note,m.primary.label,m.secondary.label].join(' ')),false,'no percentages, no verdict words in what the user reads');
});

test('popover for thread observation only, and for a trusted account',()=>{
 const m=popoverModel({username:'cristi.baluta',thread});
 assert.equal(m.title,'@cristi.baluta · 本串 7 則');
 assert.deepEqual(m.chips,['本串 7 則','3 個帳號貼同一段']);
 assert.equal(m.line,THREAD_ONLY_NOTE);
 assert.deepEqual(m.secondary,{action:'live',label:'即時查'},'an unchecked account offers 即時查 (§4.3)');
 assert.deepEqual(m.site,{label:'到 Whospost 網站查',href:checkUrl('cristi.baluta')},'the site link stays, below');
 assert.deepEqual(popoverModel({username:'cristi.baluta',thread,liveAvailable:false}).secondary,{label:'用 Whospost 查這個帳號',href:checkUrl('cristi.baluta')},'with the control switched off, the site link is the action');
 assert.deepEqual(popoverModel({username:'x',entry,trusted:true}).primary,{action:'untrust',label:'取消信任'});
 assert.equal(popoverModel({username:'x',entry}).site,null,'a listed account has its evidence instead');
});

test('the folded row (§3 item 1) counts its replies and names the two most common reasons',()=>{
 const members=[{entry},{entry:{...entry,hits:['content-comments']}},{thread:threadVerdict({replies:12,sameContent:0})}];
 assert.deepEqual(stubText(members),{title:'已收起 3 則',reasons:['留言大量重複','同篇超過 10 次'],text:'留言大量重複、同篇超過 10 次'});
 assert.deepEqual(stubText([{thread:threadVerdict({replies:12})}]),{title:'已收起 1 則',reasons:['本串 12 則'],text:'本串 12 則'});
 assert.deepEqual(stubText([]),{title:'已收起 0 則',reasons:[],text:''});
});

test('pill, toasts and the popup summary speak in results, not engineering counts',()=>{
 assert.deepEqual(pillText(4),{title:'已收起 4 則',action:'顯示全部'});assert.equal(pillText(0),null);
 assert.equal(toastText('trust',{username:'_randomdev001'}),'已信任 @_randomdev001，之後不再收起');
 assert.equal(toastText('untrust',{username:'x'}),'已取消信任 @x');
 assert.equal(toastText('trustAll',{count:3}),'已信任 3 個帳號，之後不再收起');
 assert.equal(toastText('show',{count:2}),'已顯示 2 則');assert.equal(toastText('showAll',{count:4}),'已顯示全部 4 則');assert.equal(toastText('nope'),'');
 assert.equal(pageSummary({collapsed:4,listed:2,thread:1}),'已收起 4 則 · 查過 2 個帳號 · 本串觀察 1 個帳號');
 assert.equal(pageSummary({}),'已收起 0 則');
 assert.equal(LIST_UNREADABLE,'清單暫時無法讀取');
});

test('dates print as M/D in Taipei',()=>{
 assert.equal(shortDate('2026-10-20T17:00:00Z'),'10/21');assert.equal(shortDate('2026-10-20T03:00:00Z'),'10/20');assert.equal(shortDate(null),'');assert.equal(shortDate('junk'),'');
});
