import test from 'node:test';
import assert from 'node:assert/strict';
import {chipText,scoreText,reasonChips,nameReasons,nameMarks,popoverModel,stubText,pillText,toastText,pageSummary,checkUrl,scanUrl,shortDate,SIGNAL_LABELS,SIGNAL_IDS,SIGNAL_SHORT,SITE,PRIVACY_DELETION_URL,aiSource,AI_NOTE,THREAD_ONLY_NOTE,LIST_UNREADABLE} from '../../extension/lib/label.mjs';
import {signalScore} from '../../shared/signals.mjs';
import {threadVerdict} from '../../extension/lib/thread.mjs';
const entry={h:'a'.repeat(64),score:4,hits:['content-comments','thread-focus','author-focus','burst-replies'],assessed:5,unknown:1,evidence:'rules',ai:{summary:'該帳號的留言高度重複。',version:'gemini-3.8-flash'},scanId:'abc def',updated:'2026-10-18T03:00:00Z',appeals:0};
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

test('no summing-up sentence (Felix 10-24): a checked result is named in the chip\'s words only',()=>{
 assert.equal(scoreText(entry),'6 項中 4 項符合');
 assert.equal(scoreText({...entry,score:0,hits:[]}),'暫無疑慮');
 assert.equal(scoreText({...entry,score:null}),'查過、資料不足');assert.equal(scoreText(null),'查過、資料不足');
 assert.deepEqual(chipText({entry:{...entry,score:0,hits:[]}}),{text:'暫無疑慮',tone:'clear'},'a listed 0 says the same as the popover title');
 for(const sentence of ['留言像機器在發','在同一篇下連發留言','在同一篇下狂留言','貼文一再重複','集中回覆同一個人','和另一個帳號互相集中回覆'])
  assert.equal(JSON.stringify(popoverModel({username:'x',entry:{...entry,ai:null}})).includes(sentence),false,sentence);
});

test('popover for a listed account (Felix 10-24): title with the reason chips on its line, AI review when there is one with 「AI 判斷，僅供參考」, evidence; no counts line, no trust, no appeal link',()=>{
 const m=popoverModel({username:'_randomdev001',entry});
 assert.equal(m.title,'@_randomdev001','with an AI summary the title is the account alone; the summary sits right under it');
 assert.deepEqual(m.chips,['留言大量重複','同篇超過 10 次','半數以上給同一作者','10 秒內連留 3 次'],'on the title\'s line, to its right');
 assert.deepEqual(m.ai,{text:'該帳號的留言高度重複。',source:'Gemini 自動撰寫'},'the list entry\'s ai.summary, no heading of its own');
 assert.equal(m.note,AI_NOTE);assert.equal(AI_NOTE,'AI 判斷，僅供參考');
 const noAi=popoverModel({username:'x',entry:{...entry,ai:null}});
 assert.equal(noAi.ai,null,'no AI summary on the list → no AI part at all, never an empty one');
 assert.equal(noAi.note,null,'no AI summary → no 「僅供參考」 line either; the buttons follow the title');
 assert.equal(noAi.title,'@x','reason chips on the title line say it; no 「6 項中 4 項符合」 (Felix 10-26)');
 assert.equal(popoverModel({username:'x',entry:{...entry,ai:null,score:0,hits:[]}}).title,'@x · 暫無疑慮');
 assert.equal(popoverModel({username:'x',entry:{...entry,ai:null,score:null,hits:[],live:true}}).title,'@x · 查過、資料不足','a finished 即時查 with nothing assessable (a list entry like that draws no chip, §3.1)');
 assert.equal(m.line,null,'the check counts and the date live on the evidence page now');
 assert.deepEqual(m.secondary,{label:'看完整證據',href:scanUrl('abc def')});
 assert.equal('primary' in m||'deletion' in m,false,'trust and the appeal link are not in the popover');
 assert.deepEqual(reasonChips({entry,thread}),['留言大量重複','同篇超過 10 次','半數以上給同一作者','10 秒內連留 3 次','本串 7 則','3 個帳號貼同一段']);
 const withAi=popoverModel({username:'x',entry:{...entry,ai:{summary:'  留言多是同一句附和，集中在同一位作者的貼文下。 ',version:'claude-sonnet-5-5'}}});
 assert.deepEqual(withAi.ai,{text:'留言多是同一句附和，集中在同一位作者的貼文下。',source:'Claude 自動撰寫'},'the fallback model\'s summary says Claude, not Gemini (#68)');
 assert.equal(aiSource('gemini-3.8-flash'),'Gemini 自動撰寫');assert.equal(aiSource('Claude-Haiku-5-5'),'Claude 自動撰寫');
 for(const v of [null,undefined,'','gpt-x','fixture','geminix','claudebeta'])assert.equal(aiSource(v),'AI 自動撰寫',`unknown model ${v} → no provider named`);
 assert.equal(popoverModel({username:'x',entry:{...entry,ai:{summary:'   '}}}).ai,null,'a blank summary is no summary');
 assert.equal(popoverModel({username:'x',entry:{...entry,scanId:null}}).secondary.label,'用 Whospost 重新查詢');
 assert.equal(/%|網軍|機率/.test([m.title,m.ai.text,m.note,m.secondary.label].join(' ')),false,'no percentages, no verdict words in what the user reads');
});

test('beside the name (Felix 10-24): a checked account\'s reason chips in place of the score chip; status chips stay',()=>{
 const listedChip=chipText({entry});
 assert.deepEqual(nameMarks({chip:listedChip,entry}),{chip:null,reasons:['留言大量重複','同篇超過 10 次','半數以上給同一作者','10 秒內連留 3 次'],tone:'orange',partial:false},'no 「6 項中 4 項符合」 chip');
 assert.deepEqual(nameMarks({chip:chipText({entry:{...entry,score:1,hits:['content-comments']}}),entry:{...entry,score:1,hits:['content-comments']}}),{chip:null,reasons:['留言大量重複'],tone:'grey',partial:false});
 assert.deepEqual(nameMarks({chip:chipText({entry:{...entry,score:0,hits:[]}}),entry:{...entry,score:0,hits:[]}}),{chip:{text:'暫無疑慮',tone:'clear'},reasons:[],tone:'clear',partial:false},'checked with no hit: a light green 暫無疑慮 (Felix 10-26)');
 for(const chip of [{text:'已信任',tone:'green'},{text:'查詢中…',tone:'grey',busy:true},{text:'本串 7 則',tone:'blue'}])
  assert.deepEqual(nameMarks({chip,entry}),{chip,reasons:[],tone:chip.tone,partial:false},chip.text);
 assert.deepEqual(nameMarks({}),{chip:null,reasons:[],tone:null,partial:false});
 // 快篩 (Felix 10-26): the reason chips, dashed, after a dashed 「快篩」 mark; no hit yet keeps the status chip.
 const quick={...entry,score:2,hits:['content-comments','thread-focus'],live:true,partial:true};
 assert.deepEqual(nameMarks({chip:chipText({entry:quick}),entry:quick}),{chip:{text:'快篩',tone:'grey',partial:true},reasons:['留言大量重複','同篇超過 10 次'],tone:'grey',partial:true});
 const quick3={...quick,score:3,hits:['content-comments','thread-focus','burst-replies']};
 assert.equal(nameMarks({chip:chipText({entry:quick3}),entry:quick3}).tone,'orange','3 hits in a 快篩: light red, dashed');
 const quick0={...quick,score:0,hits:[]};
 assert.deepEqual(nameMarks({chip:chipText({entry:quick0}),entry:quick0}),{chip:{text:'快篩 目前沒線索',tone:'grey',partial:true},reasons:[],tone:'grey',partial:true});
});

test('reason chips (Felix 10-24): a checked account\'s hits in rule order; none when trusted, unchecked or thread-only',()=>{
 assert.deepEqual(nameReasons({entry}),['留言大量重複','同篇超過 10 次','半數以上給同一作者','10 秒內連留 3 次']);
 assert.deepEqual(nameReasons({entry:{...entry,score:0,hits:[]}}),[]);
 assert.deepEqual(nameReasons({entry,trusted:true}),[]);
 assert.deepEqual(nameReasons({entry:{...entry,score:null}}),[],'nothing assessable, nothing to name');
 assert.deepEqual(nameReasons({entry:null}),[]);
 assert.deepEqual(nameReasons({entry:{...entry,hits:['content-comments','not-a-rule']}}),['留言大量重複'],'only rules the extension can name');
});

test('popover for thread observation only: the thread note stays, 即時查, the site link; no 僅供參考 line',()=>{
 const m=popoverModel({username:'cristi.baluta',thread});
 assert.equal(m.title,'@cristi.baluta · 本串 7 則');
 assert.equal(m.note,null);assert.deepEqual(m.chips,[],'the thread mark is in the title already');
 assert.equal(m.line,THREAD_ONLY_NOTE);assert.equal(m.ai,null);
 assert.deepEqual(m.secondary,{action:'live',label:'即時查'},'an unchecked account offers 即時查 (§4.3)');
 assert.deepEqual(m.site,{label:'到 Whospost 網站查',href:checkUrl('cristi.baluta')},'the site link stays, below');
 assert.deepEqual(popoverModel({username:'cristi.baluta',thread,liveAvailable:false}).secondary,{label:'用 Whospost 查這個帳號',href:checkUrl('cristi.baluta')},'with the control switched off, the site link is the action');
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
