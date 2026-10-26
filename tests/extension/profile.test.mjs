import test from 'node:test';
import assert from 'node:assert/strict';
import {pageTokens,hovercardRequest,aboutRequest,parseHovercard,parseAbout,parseJoined,statusKind,cacheGet,cachePut,slot,recordRequest,emptyUsage,noteOutcome,emptyBreaker,paused,flagFromHealth,flagStale,isNewAccount,newAccountMark,HOVERCARD_DOC_ID,ABOUT_APP_ID,MIN_GAP_MS,HOURLY_LIMIT,HOUR_MS,CACHE_TTL_MS,CACHE_MAX,FAIL_STOP,PAUSE_MS,NEW_ACCOUNT_DAYS} from '../../extension/lib/profile.mjs';
import {backgroundSection,popupLine,NEW_TITLE,PAUSED_TEXT} from '../../extension/lib/profile-label.mjs';
import {placeMark,countryCode,flagEmoji} from '../../extension/lib/country-flag.mjs';
import {hovercard,hovercardMissing,about,pageScripts,COOKIE,COOKIE_SIGNED_OUT,BKV} from './fixtures/profile.mjs';
// 帳號背景 (EXTENSION-SPEC §4.4): the pure parts. Requests and answers are in the shape measured on 2026-10-24.
const NOON=Date.UTC(2026,9,24,4,0,0);
test('page tokens: fb_dtsg, lsd, the Bloks version and csrftoken from a signed-in page; jazoest is 2 + the char-code sum',()=>{
 const t=pageTokens(pageScripts(),COOKIE);
 assert.equal(t.ready,true);assert.equal(t.loggedIn,true);assert.equal(t.dtsg,'DTSGfixture:1');assert.equal(t.lsd,'LSDfixture');assert.equal(t.bkv,BKV);assert.equal(t.csrf,'CSRFfixture');
 assert.equal(t.jazoest,'2'+[...'DTSGfixture:1'].reduce((n,c)=>n+c.charCodeAt(0),0));
 const out=pageTokens(pageScripts(),COOKIE_SIGNED_OUT);assert.equal(out.loggedIn,false);assert.equal(out.ready,false,'signed out: never ready');
 const changed=pageTokens('nothing here',COOKIE);assert.equal(changed.loggedIn,true);assert.equal(changed.ready,false,'signed in but the page changed');
});
test('the two requests: same origin, the page\'s own query ids, the user id only in the dialog request, zh-TW labels asked for',()=>{
 const t=pageTokens(pageScripts(),COOKIE);
 const card=hovercardRequest('user01',t),body=new URLSearchParams(card.init.body);
 assert.equal(card.url,'/graphql/query');assert.equal(card.init.method,'POST');assert.equal(card.init.credentials,'include');
 assert.equal(body.get('doc_id'),HOVERCARD_DOC_ID);assert.equal(HOVERCARD_DOC_ID,'29110045098632409');
 assert.equal(JSON.parse(body.get('variables')).username,'user01');assert.equal(body.get('fb_dtsg'),t.dtsg);assert.equal(body.get('jazoest'),t.jazoest);
 assert.equal(card.init.headers['X-CSRFToken'],'CSRFfixture');assert.equal(card.init.headers['X-IG-App-ID'],'238260118697367');
 const dialog=aboutRequest('1234567890',t),dbody=new URLSearchParams(dialog.init.body);
 assert.match(dialog.url,new RegExp(`^/async/wbloks/fetch/\\?appid=${ABOUT_APP_ID.replace(/\./g,'\\.')}&type=app&__bkv=${BKV}&hl=zh-tw$`));
 assert.deepEqual(JSON.parse(dbody.get('params')),{referer_type:'TextPostAppProfileOverflow',target_user_id:'1234567890'});
 for(const r of [card,dialog])assert.equal(/whospost/i.test(JSON.stringify(r)),false,'nothing about Whospost goes to Threads');
});
test('hover card: user id, followers and privacy; null for an account Threads does not have; anything else is a parse failure',()=>{
 assert.deepEqual(parseHovercard(hovercard(),'user01'),{pk:'1234567890',followers:1234,isPrivate:false});
 assert.deepEqual(parseHovercard(hovercard({followers:0}),'USER01'),{pk:'1234567890',followers:0,isPrivate:false},'0 followers is a count');
 assert.equal(parseHovercard(hovercard({followers:-1}),'user01').followers,null);
 assert.equal(parseHovercard(hovercardMissing(),'user01'),null);
 for(const bad of ['<html>login</html>','for (;;);{"error":1}',hovercard({username:'someone_else'})])assert.throws(()=>parseHovercard(bad,'user01'),{code:'PARSE'});
});
test('dialog: joined month, country from the page state, renames from 先前的用戶名稱; style values between label and value are skipped',()=>{
 assert.deepEqual(parseAbout(about()),{joined:{year:2026,month:9,text:'2026年9月 · #301,234,567'},country:'台灣',countryShared:true,renames:0});
 assert.equal(parseAbout(about({former:'在 Threads 變更過 2 次'})).renames,2);
 assert.equal(parseAbout(about({former:'在 Threads 變更過 1,024 次'})).renames,1024);
 assert.equal(parseAbout(about({former:'有變更'})).renames,null,'the row is there but its number is not: not 0');
 const hidden=parseAbout(about({shared:false,country:'美國'}));assert.equal(hidden.country,null);assert.equal(hidden.countryShared,false);
 const en=parseAbout(about({labels:'en',joined:'July 2023 · #1',country:'United States'}));assert.deepEqual(en.joined,{year:2023,month:7,text:'July 2023 · #1'});assert.equal(en.country,'United States');
 assert.throws(()=>parseAbout(about({drop:[1]})),{code:'PARSE'},'no joined row: the layout changed');
 assert.throws(()=>parseAbout('{"payload":{}}'),{code:'PARSE'});assert.throws(()=>parseAbout('not json'),{code:'PARSE'});
 assert.equal(parseJoined('2026年13月'),null);assert.equal(parseJoined(''),null);
});
test('status kinds for the stop rule: only 429 and 403 are refusals',()=>{
 assert.equal(statusKind(200),'ok');assert.equal(statusKind(429),'refused');assert.equal(statusKind(403),'refused');assert.equal(statusKind(500),'error');assert.equal(statusKind(0),'error');
});
test('cache, three answers kept apart: a fresh entry (data), an expired one (nothing), never a failure; 7 days, newest kept when full',()=>{
 const data={followers:1,joined:{year:2026,month:9}};
 let c=cachePut({},'user01',data,NOON);
 assert.deepEqual(cacheGet(c,'user01',NOON+CACHE_TTL_MS-1),data);
 assert.equal(cacheGet(c,'user01',NOON+CACHE_TTL_MS),null,'7 days later it is read again');
 assert.equal(cacheGet(c,'user02',NOON),null);assert.equal(cacheGet({user01:{at:NOON}},'user01',NOON),null,'no data, no hit');
 assert.equal(CACHE_TTL_MS,7*24*HOUR_MS);
 c={};for(let i=0;i<CACHE_MAX+5;i++)c=cachePut(c,`u${i}`,data,NOON+i);
 assert.equal(Object.keys(c).length,CACHE_MAX);assert.ok(c[`u${CACHE_MAX+4}`]);assert.equal(c.u0,undefined,'oldest dropped');
 assert.equal(Object.keys(cachePut({old:{at:NOON-CACHE_TTL_MS,data}},'new',data,NOON)).join(),'new','expired entries are pruned on write');
});
test('pacing: one account every 2 seconds, 300 an hour (Felix 10-26); the 301st waits for the oldest to leave the hour',()=>{
 assert.equal(MIN_GAP_MS,2000);assert.equal(HOURLY_LIMIT,300);
 let u=emptyUsage();assert.equal(slot(u,NOON).allowed,true);
 u=recordRequest(u,NOON);
 assert.deepEqual(slot(u,NOON+1999),{allowed:false,reason:'gap',retryAt:NOON+2000,remaining:HOURLY_LIMIT-1});
 assert.equal(slot(u,NOON+2000).allowed,true);
 for(let i=1;i<HOURLY_LIMIT;i++)u=recordRequest(u,NOON+i*2000);
 const full=slot(u,NOON+HOURLY_LIMIT*2000);assert.equal(full.allowed,false);assert.equal(full.reason,'hourly');assert.equal(full.retryAt,NOON+HOUR_MS);
 assert.equal(slot(u,NOON+HOUR_MS).allowed,true,'the first stamp left the hour');
 assert.equal(slot({stamps:['x',null,NOON+HOUR_MS]},NOON).allowed,true,'junk and future stamps ignored');
});
test('stop rule: three refusals or unreadable answers in a row pause for six hours; a success clears it; other errors neither count nor clear',()=>{
 assert.equal(FAIL_STOP,3);assert.equal(PAUSE_MS,6*HOUR_MS);
 let b=emptyBreaker();
 b=noteOutcome(b,'refused',NOON);b=noteOutcome(b,'error',NOON);b=noteOutcome(b,'parse',NOON);
 assert.equal(b.fails,2);assert.equal(paused(b,NOON),false);
 b=noteOutcome(b,'refused',NOON+5);assert.equal(paused(b,NOON+5),true);assert.equal(b.reason,'refused');
 assert.equal(paused(b,NOON+5+PAUSE_MS),false,'comes back on its own');
 assert.deepEqual(noteOutcome({fails:2,pausedAt:null,reason:null},'ok',NOON),emptyBreaker());
 assert.equal(paused(null,NOON),false);assert.equal(paused({pausedAt:'x'},NOON),false);
});
test('remote switch: /api/health extension.profileLookup; missing field = on; no answer keeps the last value; read once an hour',()=>{
 assert.deepEqual(flagFromHealth({extension:{profileLookup:false}},null,NOON),{on:false,checkedAt:NOON});
 assert.deepEqual(flagFromHealth({ok:true},null,NOON),{on:true,checkedAt:NOON});
 assert.deepEqual(flagFromHealth(null,{on:false,checkedAt:NOON-10},NOON),{on:false,checkedAt:NOON-10,failedAt:NOON});
 assert.equal(flagFromHealth(null,null,NOON).on,true);
 assert.equal(flagStale(null,NOON),true);assert.equal(flagStale({on:true,checkedAt:NOON},NOON+HOUR_MS-1),false);assert.equal(flagStale({on:true,checkedAt:NOON},NOON+HOUR_MS),true);
 assert.equal(flagStale({on:false,checkedAt:NOON-2*HOUR_MS,failedAt:NOON},NOON+1),false,'a failed read also waits an hour');
});
test('新帳號: under 60 days counting from the first day of the joined month, and only with this thread\'s count at the chip threshold or a list entry',()=>{
 assert.equal(NEW_ACCOUNT_DAYS,60);
 const joined=(year,month)=>({year,month});
 assert.equal(isNewAccount(joined(2026,9),NOON),true,'2026-09-01 is 53 days before 10-24');
 assert.equal(isNewAccount(joined(2026,8),NOON),false,'2026-08-01 is 84 days before');
 assert.equal(isNewAccount(joined(2026,8),Date.UTC(2026,8,29)),true);assert.equal(isNewAccount(joined(2026,8),Date.UTC(2026,8,30)),false,'day 60 is no longer new');
 assert.equal(isNewAccount(null,NOON),false);
 const data={joined:joined(2026,9)};
 assert.equal(newAccountMark({data,threadReplies:5,barAt:5,now:NOON}),true);
 assert.equal(newAccountMark({data,threadReplies:4,barAt:5,now:NOON}),false,'new but quiet here and not listed: no mark');
 assert.equal(newAccountMark({data,listed:true,now:NOON}),true);
 assert.equal(newAccountMark({data:{joined:joined(2025,1)},threadReplies:50,listed:true,now:NOON}),false);
 assert.equal(newAccountMark({data:null,listed:true,now:NOON}),false,'not read: no mark');
});
test('place beside the name (Felix 10-24): a flag for the names Threads uses in English and Chinese, the text when unknown, the full name as the title',()=>{
 assert.deepEqual(placeMark('羅馬尼亞'),{text:'🇷🇴',title:'羅馬尼亞',flag:true});
 assert.deepEqual(placeMark('Romania'),{text:'🇷🇴',title:'Romania',flag:true});
 for(const [names,code] of [[['台灣','臺灣','Taiwan'],'TW'],[['中國','China'],'CN'],[['香港','Hong Kong'],'HK'],[['美國','United States'],'US'],[['日本','Japan'],'JP'],[['韓國','South Korea'],'KR'],[['新加坡','Singapore'],'SG'],[['馬來西亞','Malaysia'],'MY'],[['泰國','Thailand'],'TH'],[['越南','Vietnam'],'VN'],[['菲律賓','Philippines'],'PH'],[['印尼','Indonesia'],'ID'],[['印度','India'],'IN'],[['英國','United Kingdom'],'GB'],[['德國','Germany'],'DE'],[['法國','France'],'FR'],[['俄羅斯','Russia'],'RU'],[['烏克蘭','Ukraine'],'UA'],[['澳洲','Australia'],'AU'],[['加拿大','Canada'],'CA']])
  for(const n of names)assert.equal(countryCode(n),code,n);
 assert.equal(countryCode('  united states '),'US','case and spaces do not matter');
 assert.equal(flagEmoji('TW'),'🇹🇼');assert.equal(flagEmoji('tw'),'');assert.equal(flagEmoji(null),'');
 assert.deepEqual(placeMark('亞特蘭提斯'),{text:'亞特蘭提斯',title:'亞特蘭提斯',flag:false},'not in the table: the place as text');
 assert.equal(placeMark(null),null);assert.equal(placeMark('  '),null);
});

test('wording: the popover section shows only what was read, never follower or following counts; says why when nothing was; 改名 is read but not shown (Felix 10-24)',()=>{
 const data={joined:{year:2026,month:9,text:'2026年9月 · #301,234,567'},country:'台灣',countryShared:true,renames:2,followers:1234};
 const s=backgroundSection({state:'ok',data,isNew:true});
 assert.deepEqual(s.rows,[['加入','2026年9月'],['所在地點','台灣']],'no 改名 row for now; the data keeps renames');
 assert.ok(!s.rows.flat().some(v=>/粉絲|追蹤/.test(v)),'no 粉絲 or 追蹤 row');
 assert.equal('note' in s,false,'the source line left the popover');assert.equal(s.newNote,NEW_TITLE);assert.match(NEW_TITLE,/新帳號不等於假帳號/);
 assert.deepEqual(backgroundSection({state:'ok',data:{...data,country:null,countryShared:false,renames:0,followers:null}}).rows.slice(1),[['所在地點','未分享']]);
 for(const state of ['loading','queued','failed','none','remoteOff','paused','signedOut','hourly']){const x=backgroundSection({state});assert.deepEqual(x.rows,[]);assert.ok(x.status.length>3,state);}
 assert.match(backgroundSection({state:'hourly',retryAt:'13:05'}).status,/13:05/);
 assert.match(backgroundSection({state:'paused'}).status,/帳號背景暫停/);assert.equal(PAUSED_TEXT,'帳號背景暫停');
 assert.match(popupLine({on:false}),/已關閉/);assert.match(popupLine({on:true,isPaused:true,breaker:{reason:'refused'}}),/帳號背景暫停/);
 assert.match(popupLine({on:true,cached:3,remaining:58}),/3 個帳號.*58 次.*只存在你的電腦/);
});
test('joined, beside the flag (Felix 10-26): this month, N months, N years; nothing without a month',async()=>{
 const {joinedAgo}=await import('../../extension/lib/profile-label.mjs');
 const OCT=Date.UTC(2026,9,26,4,0,0);
 assert.equal(joinedAgo({year:2026,month:10},OCT),'近 1 個月加入');
 assert.equal(joinedAgo({year:2026,month:7},OCT),'3 個月前加入');
 assert.equal(joinedAgo({year:2025,month:11},OCT),'11 個月前加入');
 assert.equal(joinedAgo({year:2024,month:3},OCT),'2 年前加入');
 assert.equal(joinedAgo({year:2026,month:11},OCT),null,'a month ahead of today is not shown');
 assert.equal(joinedAgo(null,OCT),null);
});
