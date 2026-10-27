import test from 'node:test';
import assert from 'node:assert/strict';
import {pageDelta,mergeDelta,addDelta,dailyPayload,brokenPayload,markSent,brokenDue,markBroken,tallyText,emptyReport,COUNTERS,COUNT_MAX,REPORT_PATH} from '../../extension/lib/report.mjs';
import {mergeSettings} from '../../extension/lib/settings.mjs';

// 2026-10-23 12:00 Taipei, and the same hour the next two days.
const D23=Date.parse('2026-10-23T04:00:00Z'),D24=D23+86400000,D25=D24+86400000,D27=D25+2*86400000;
const V='0.3.0';

test('pageDelta: only what grew since the page last contributed; nothing grew → null; a shrink (replies shown again) is not negative',()=>{
 assert.deepEqual(pageDelta({},{pages:1,compared:12,listed:3,flagged:1,thread:0,collapsed:2}),{pages:1,compared:12,listed:3,flagged:1,collapsed:2});
 assert.deepEqual(pageDelta({pages:1,compared:12,listed:3,flagged:1,collapsed:2},{pages:1,compared:20,listed:3,flagged:1,collapsed:0}),{compared:8});
 assert.equal(pageDelta({pages:1,compared:12},{pages:1,compared:12}),null);
 assert.equal(pageDelta(null,{}),null);assert.equal(pageDelta(undefined,{compared:'junk',pages:-3}),null);
 assert.deepEqual(mergeDelta({compared:3,trusted:1},{compared:2,pages:1}),{compared:5,trusted:1,pages:1});
 assert.deepEqual(mergeDelta(null,{trusted:COUNT_MAX+5}),{trusted:COUNT_MAX},'clamped');
});

test('addDelta accumulates into today\'s tally; the first contact of a later day hands the finished day over as one daily report',()=>{
 const a=addDelta(null,{pages:1,compared:12,listed:3},{now:D23,version:V});
 assert.deepEqual(a.report,{tally:{day:'2026-10-23',pages:1,compared:12,listed:3,flagged:0,thread:0,collapsed:0,trusted:0,ai:0,background:0,blocked:0},pending:null,brokenDay:null,sentDay:null,sentAt:null});
 assert.equal(a.send,null,'nothing to post yet');
 const b=addDelta(a.report,{pages:1,compared:8,trusted:2},{now:D23+3600000,version:V});
 assert.equal(b.send,null);assert.equal(b.report.tally.compared,20);assert.equal(b.report.tally.pages,2);assert.equal(b.report.tally.trusted,2);
 const c=addDelta(b.report,{pages:1,compared:5},{now:D24,version:V});
 assert.deepEqual(c.send,{kind:'daily',v:V,day:'2026-10-23',pages:2,compared:20,listed:3,flagged:0,thread:0,collapsed:0,trusted:2,ai:0,background:0,blocked:0});
 assert.deepEqual(c.report.tally,{day:'2026-10-24',pages:1,compared:5,listed:0,flagged:0,thread:0,collapsed:0,trusted:0,ai:0,background:0,blocked:0},'a fresh tally for the new day');
 assert.deepEqual(Object.keys(c.send),['kind','v','day',...COUNTERS]);
 for(const forbidden of ['h','username','installId','installHash','url','ua'])assert.equal(forbidden in c.send,false,forbidden);
 const rollover=addDelta(b.report,null,{now:D24,version:V});
 assert.deepEqual(rollover.send,c.send,'a null delta still rolls the day over');
 assert.equal(rollover.report.tally.pages,0);
});

test('a finished day that saw no page is dropped; a report that failed to post is retried next time and replaced or dropped when stale',()=>{
 const idle=addDelta(addDelta(null,{trusted:1},{now:D23,version:V}).report,null,{now:D24,version:V});
 assert.equal(idle.send,null,'no pages: nothing worth sending');assert.equal(idle.report.pending,null);
 const finished=addDelta(addDelta(null,{pages:1,compared:3},{now:D23,version:V}).report,{pages:1},{now:D24,version:V});
 assert.equal(finished.send.day,'2026-10-23');
 const retry=addDelta(finished.report,{compared:2},{now:D24+60000,version:V});
 assert.deepEqual(retry.send,finished.send,'not marked sent, so it is offered again');
 const replaced=addDelta(retry.report,null,{now:D25,version:V});
 assert.equal(replaced.send.day,'2026-10-24','the newer finished day takes the single slot');
 const stale=addDelta(replaced.report,null,{now:D27,version:V});
 assert.equal(stale.send,null,'older than PENDING_DAYS: dropped, the server would refuse it anyway');
 const sent=markSent(finished.report,finished.send,D24);
 assert.equal(sent.pending,null);assert.equal(sent.sentDay,'2026-10-23');assert.equal(sent.sentAt,D24);
 assert.equal(addDelta(sent,{pages:1},{now:D24,version:V}).send,null);
 assert.equal(addDelta({tally:'junk'},{pages:1},{now:D23,version:V}).report.tally.pages,1,'a malformed record is replaced');
});

test('dom_broken: version and day only, once per Taipei day',()=>{
 assert.deepEqual(brokenPayload(V,D23),{kind:'dom_broken',v:V,day:'2026-10-23'});
 assert.equal(brokenDue(null,D23),true);assert.equal(brokenDue(emptyReport(),D23),true);
 const marked=markBroken(null,D23);
 assert.equal(marked.brokenDay,'2026-10-23');assert.equal(brokenDue(marked,D23+3600000),false);assert.equal(brokenDue(marked,D24),true);
 assert.equal(markBroken({tally:{day:'2026-10-23',pages:1}},D23).tally.pages,1,'the tally is kept');
 assert.equal(REPORT_PATH,'/api/list/v1/telemetry');
 assert.deepEqual(dailyPayload({day:'2026-10-23',pages:1,compared:COUNT_MAX+1},V),{kind:'daily',v:V,day:'2026-10-23',pages:1,compared:COUNT_MAX,listed:0,flagged:0,thread:0,collapsed:0,trusted:0,ai:0,background:0,blocked:0});
});

test('tallyText says what today\'s report holds so far; the setting defaults on and merges like the others',()=>{
 assert.equal(tallyText(null),'今天還沒有累計。');
 const r=addDelta(null,{pages:2,compared:30,listed:4,collapsed:3,trusted:1,ai:0,background:0,blocked:0},{now:D23,version:V}).report;
 assert.equal(tallyText(r),'今天累計：看了 2 頁 · 比對 30 個帳號 · 清單上 4 個 · 收起 3 則 · 信任 1 次');
 assert.equal(tallyText(markSent(r,{day:'2026-10-22'},D23)),'今天累計：看了 2 頁 · 比對 30 個帳號 · 清單上 4 個 · 收起 3 則 · 信任 1 次 · 上次送出 10/22');
 assert.match(tallyText({...r,pending:{day:'2026-10-22'}}),/10\/22 的一筆還沒送出$/);
 assert.equal(mergeSettings(null).report,true);assert.equal(mergeSettings({report:false}).report,false);assert.equal(mergeSettings({report:'no'}).report,true);
});

test('the tally takes AI 打詐, 查詢背景 and 封鎖 presses (Felix 10-27) like any other count',()=>{
 const r=addDelta(null,{ai:1,background:2,blocked:1},{now:D23,version:V}).report;
 assert.deepEqual([r.tally.ai,r.tally.background,r.tally.blocked],[1,2,1]);
 assert.deepEqual(dailyPayload(r.tally,V),{kind:'daily',v:V,day:'2026-10-23',pages:0,compared:0,listed:0,flagged:0,thread:0,collapsed:0,trusted:0,ai:1,background:2,blocked:1});
});
