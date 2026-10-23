import test from 'node:test';
import assert from 'node:assert/strict';
import {barText,whyCard,counterText,checkUrl,scanUrl,shortDate,SIGNAL_LABELS,SIGNAL_IDS,SIGNAL_SHORT,SITE,PRIVACY_DELETION_URL,NOT_IDENTITY} from '../../extension/lib/label.mjs';
import {signalScore} from '../../shared/signals.mjs';
import {threadVerdict} from '../../extension/lib/thread.mjs';
const entry={h:'a'.repeat(64),score:4,hits:['content-comments','thread-focus','author-focus'],assessed:5,unknown:1,evidence:'rules',ai:{summary:'該帳號的留言高度重複。',version:'g'},scanId:'abc def',updated:'2026-10-20T03:00:00Z',appeals:0};
const thread=threadVerdict({replies:7,sameContent:3});

test('the six rule labels are the site\'s own, read from signalScore, in its order',()=>{
 assert.deepEqual(SIGNAL_IDS,signalScore({}).items.map(i=>i.id));
 assert.deepEqual(SIGNAL_LABELS,Object.fromEntries(signalScore({}).items.map(i=>[i.id,i.label])));
 assert.deepEqual(Object.keys(SIGNAL_SHORT).sort(),[...SIGNAL_IDS].sort(),'every rule has a short name for the bar');
});

test('links open the site with from=ext, the username encoded; the deletion link is the privacy page anchor',()=>{
 assert.equal(SITE,'https://whospost.felixlai.workers.dev');
 assert.equal(checkUrl('Zuck'),'https://whospost.felixlai.workers.dev/?u=Zuck&from=ext');
 assert.equal(checkUrl('a&b'),'https://whospost.felixlai.workers.dev/?u=a%26b&from=ext');
 assert.equal(scanUrl('abc def'),'https://whospost.felixlai.workers.dev/?scan=abc%20def&from=ext');
 assert.equal(PRIVACY_DELETION_URL,'https://whospost.felixlai.workers.dev/privacy#deletion');
});

test('bar (§3.1): source · "6 項中 N 項符合" · at most two hit signals in rule order · 查於 date — 本串 part; orange from fadeAt',()=>{
 assert.deepEqual(barText({entry}),{source:'Whospost',text:'Whospost · 6 項中 4 項符合 · 留言大量重複 · 同篇留言超過 10 次 — 查於 10/20',tone:'orange'});
 assert.equal(barText({entry:{...entry,score:2}}).tone,'blue');assert.equal(barText({entry:{...entry,score:2},fadeAt:2}).tone,'orange');
 assert.equal(barText({entry,thread}).text,'Whospost · 6 項中 4 項符合 · 留言大量重複 · 同篇留言超過 10 次 — 查於 10/20 — 本串：這個帳號在這串留了 7 則、另有 2 個帳號貼了相同內容');
 assert.equal(barText({entry:{...entry,hits:[],score:0,updated:null}}).text,'Whospost · 6 項中 0 項符合');
 assert.equal(barText({entry,listStatus:'stale',generated:'2026-10-21T00:00:00Z'}).text,'Whospost · 6 項中 4 項符合 · 留言大量重複 · 同篇留言超過 10 次 — 查於 10/20 · 清單 10/21 版');
 assert.equal(barText({entry,listStatus:'fresh',generated:'2026-10-21T00:00:00Z'}).text.includes('清單'),false);
 for(const t of [barText({entry}).text,barText({thread}).text])assert.equal(/%|網軍|機率/.test(t),false,'no percentages, no verdict words');
});

test('thread-only bar is grey-blue and says what it counted; the card says it is not a query result',()=>{
 assert.deepEqual(barText({thread}),{source:'本串觀察',text:'本串觀察 · 這個帳號在這串留了 7 則 · 另有 2 個帳號貼了相同內容',tone:'blue'});
 assert.equal(barText({thread:threadVerdict({replies:5,sameContent:1})}).text,'本串觀察 · 這個帳號在這串留了 5 則');
 const card=whyCard({username:'bot_a',thread});
 assert.equal(card.title,'@bot_a：只看你眼前載入的回覆，不是查詢結果；捲動後數字會變。');
 assert.deepEqual(card.lines.map(l=>l.label),['這個帳號在這串留了 7 則','另有 2 個帳號貼了相同內容','Whospost 還沒有這個帳號的查詢結果。']);
 assert.deepEqual(card.links.map(l=>l.label),['申訴或要求刪除','用 Whospost 查這個帳號']);
 assert.equal(card.links[1].href,checkUrl('bot_a'));assert.equal(card.note,NOT_IDENTITY);
});

test('why card for a listed account: counts, six rules with hits marked, the AI sentence, appeals, three links',()=>{
 const card=whyCard({username:'bot_a',entry:{...entry,appeals:2}});
 assert.equal(card.title,'@bot_a 查過了：6 項檢查中 4 項符合、2 項不符合、1 項資料不足。');
 assert.deepEqual(card.lines.filter(l=>l.status==='yes').map(l=>l.id),['content-comments','author-focus','thread-focus'],'in rule order');
 assert.equal(card.lines.filter(l=>SIGNAL_IDS.includes(l.id)).length,6);
 assert.equal(card.lines.find(l=>l.id==='ai').label,'AI 判讀：該帳號的留言高度重複。');
 assert.equal(card.lines.find(l=>l.id==='appeals').label,'2 人按過「信任」');
 assert.deepEqual(card.links.map(l=>l.label),['看完整證據','申訴或要求刪除','用 Whospost 重新查詢']);
 assert.equal(card.links[0].href,scanUrl('abc def'));
 assert.match(card.note,/^這不是身分判定。/);
 assert.equal(whyCard({username:'x',entry:{...entry,ai:null,appeals:0,scanId:null}}).links.length,2,'no scan id, no evidence link');
});

test('counter (§3.3): four numbers when the list is fresh; the list warning when it is not; layout and pause messages',()=>{
 assert.equal(counterText({checked:14,listed:3,flagged:1,thread:2}),'Whospost · 比對 14 · 查過 3 · 有線索 1 · 本串 2');
 assert.equal(counterText({thread:2},{listStatus:'missing'}),'Whospost · 清單暫時無法讀取 · 本串 2');
 assert.equal(counterText({checked:9,listed:1,thread:0},{listStatus:'stale'}),'Whospost · 清單暫時無法讀取（用舊版） · 比對 9 · 查過 1 · 本串 0');
 assert.equal(counterText({},{health:'broken'}),'Whospost · Threads 版面已變，等待更新');
 assert.equal(counterText({},{enabled:false}),'Whospost · 已暫停');
 assert.equal(counterText({}),'Whospost · 比對 0 · 查過 0 · 有線索 0 · 本串 0');
});

test('dates print as M/D in Taipei',()=>{
 assert.equal(shortDate('2026-10-20T17:00:00Z'),'10/21');assert.equal(shortDate('2026-10-20T03:00:00Z'),'10/20');assert.equal(shortDate(null),'');assert.equal(shortDate('junk'),'');
});
