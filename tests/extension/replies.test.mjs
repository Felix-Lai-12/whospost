import test from 'node:test';
import assert from 'node:assert/strict';
import {REPLIES_NAME,DEFAULT_DOC_ID,PAGE,MAX_ROWS,MIN_ROWS,PARENT_FILL_MAX,REPLIES_PATH,pageRelay,queryOf,repliesRequest,record,parseReplies,hiddenCodes,parentFromPostPage,withParent,submission,refused,outcomeCounter,NOTICE} from '../../extension/lib/replies.mjs';
import {pageTokens} from '../../extension/lib/profile.mjs';
import {flagsFromHealth,repliesEnabled} from '../../extension/lib/flags.mjs';
import {checkReplyRows,codeToId,codeTime} from '../../shared/reply-rows.mjs';
import {post,repliesBody,postPageHtml,codeAt,EXECUTION_ERROR} from './fixtures/replies.mjs';
import {pageScripts,COOKIE} from './fixtures/profile.mjs';
// 留言改由擴充套件抓取 (0.2.0, P1 shadow): the pure parts, in the shapes measured on 2026-10-29/30.
const T0=Date.UTC(2026,9,30,3,0,0);
const RELAY='<script>{"__relay_internal__pv__BarcelonaIsLoggedInrelayprovider":true,"__relay_internal__pv__BarcelonaHasEventBadgerelayprovider":false}</script>';
// A thread as the Replies tab lists it: the parent (someone else's post), then the account's reply.
const thread=(i,{text='認真的長留言',parent='star',ms=T0-i*3600000}={})=>[post({username:parent,ms:ms-60000,n:1,text:`原文 ${i}`}),post({username:'sample',ms,n:2,text,reply:parent})];

test('the request: the Replies-tab query by user id, one page of 25, the page\'s own tokens and relay flags, nothing about Whospost',()=>{
 const t=pageTokens(pageScripts(),COOKIE),relay=pageRelay(RELAY);
 assert.deepEqual(relay,{__relay_internal__pv__BarcelonaIsLoggedInrelayprovider:true,__relay_internal__pv__BarcelonaHasEventBadgerelayprovider:false});
 const r=repliesRequest('63483207811',t,{docId:'39901003386179772',first:25,relay}),body=new URLSearchParams(r.init.body);
 assert.equal(r.url,'/graphql/query');assert.equal(r.init.method,'POST');assert.equal(r.init.credentials,'include');
 assert.equal(r.init.headers['X-FB-Friendly-Name'],REPLIES_NAME);assert.equal(REPLIES_NAME,'BarcelonaProfileRepliesTabRefetchableDirectQuery');
 assert.equal(body.get('doc_id'),'39901003386179772');assert.equal(body.get('fb_api_req_friendly_name'),REPLIES_NAME);assert.equal(body.get('fb_dtsg'),t.dtsg);assert.equal(body.get('lsd'),t.lsd);
 const vars=JSON.parse(body.get('variables'));
 assert.equal(vars.userID,'63483207811');assert.equal(vars.first,25);assert.equal(vars.after,null);assert.equal(vars.__relay_internal__pv__BarcelonaIsLoggedInrelayprovider,true);
 assert.equal(/whospost/i.test(JSON.stringify(r)),false);
 assert.deepEqual(queryOf(null),{docId:DEFAULT_DOC_ID,first:PAGE});assert.equal(PAGE,25);assert.equal(DEFAULT_DOC_ID,'39901003386179772');
 assert.deepEqual(queryOf({repliesQuery:{docId:'29778554931728126',first:20}}),{docId:'29778554931728126',first:20},'the site\'s query id and page size');
 assert.deepEqual(queryOf({repliesQuery:{docId:'nope',first:200}}),{docId:DEFAULT_DOC_ID,first:PAGE},'nonsense falls back');
 assert.equal(REPLIES_PATH('abc'),'/api/scans/abc/replies');
});

test('flags: the site\'s replies switch and query travel with the other switches; only a real true turns it on',()=>{
 const f=flagsFromHealth({extension:{block:true,replies:true,repliesQuery:{docId:'39901003386179772',first:25}}},T0);
 assert.deepEqual(f,{block:true,replies:true,repliesQuery:{docId:'39901003386179772',first:25},fetchedAt:T0});
 assert.equal(repliesEnabled(f),true);assert.equal(repliesEnabled(null),false,'never fetched');
 assert.equal(repliesEnabled(flagsFromHealth({extension:{block:true}},T0)),false,'an answer without the switch: off');
 assert.equal(repliesEnabled(flagsFromHealth({extension:{replies:'1'}},T0)),false,'only a real true');
 assert.deepEqual(flagsFromHealth({extension:{replies:true,repliesQuery:{docId:12,first:'25'}}},T0).repliesQuery,{docId:null,first:null},'a malformed query is not kept');
});

test('the answer: the account\'s replies in other people\'s threads become rows with their parents, in page order; own-thread replies are left out; errors beside data are not a failure',()=>{
 const own=[post({username:'sample',ms:T0-7200000,n:1,text:'我的貼文'}),post({username:'sample',ms:T0-7100000,n:1,text:'自己補充',reply:'sample'})];
 const threads=[thread(1),thread(2,{text:'第二則',parent:'other'}),own,thread(3,{text:'第三則'})];
 const r=parseReplies(repliesBody(threads),'Sample');
 assert.equal(r.ok,true);assert.equal(r.own,4,'four of the account\'s posts seen (three replies, one own-thread reply)');
 assert.equal(r.selfThread,1);assert.equal(r.hidden,0);assert.equal(r.errors,false);
 assert.deepEqual(r.rows.map(x=>x.text),['認真的長留言','第二則','第三則']);
 const first=r.rows[0],parent=threads[0][0],reply=threads[0][1];
 assert.deepEqual(first,{id:reply.pk,text:'認真的長留言',postedAt:new Date(reply.taken_at*1000).toISOString(),url:`https://www.threads.com/@sample/post/${reply.code}`,parentUrl:`https://www.threads.com/@star/post/${parent.code}`,parentAuthor:'star',isQuote:false,isRepost:false});
 assert.deepEqual(Object.keys(first),['id','text','postedAt','url','parentUrl','parentAuthor','isQuote','isRepost'],'exactly the site\'s row keys');
 assert.equal(codeToId(reply.code),reply.pk,'the fixture\'s codes carry their ids');assert.equal(codeTime(reply.code),reply.taken_at*1000);
 // What the site will do with them: six such rows pass its own check.
 const six=parseReplies(repliesBody([1,2,3,4,5,6].map(i=>thread(i,{text:`第 ${i} 則`}))),'sample').rows;
 assert.deepEqual(checkReplyRows(six,'sample',T0),{ok:true,rows:six,dropped:[]});
 // `errors` next to data (round 4: one post's share_info could not be resolved): the rows are still read.
 const withErrors=parseReplies(repliesBody(threads,{errors:EXECUTION_ERROR}),'sample');
 assert.equal(withErrors.ok,true);assert.equal(withErrors.errors,true);assert.equal(withErrors.rows.length,3);
 // A quote and a repost are marked, a duplicate is read once, more than MAX_ROWS are cut.
 const q=parseReplies(repliesBody([[post({username:'star',ms:T0-5000}),post({username:'sample',ms:T0-4000,reply:'star',quote:true})],[post({username:'star',ms:T0-3000}),post({username:'sample',ms:T0-2000,reply:'star',repost:true})]]),'sample');
 assert.deepEqual(q.rows.map(x=>[x.isQuote,x.isRepost]),[[true,false],[false,true]]);
 const dup=parseReplies(repliesBody([thread(1),thread(1)]),'sample');assert.equal(dup.rows.length,1);
 const many=parseReplies(repliesBody(Array.from({length:MAX_ROWS+5},(_,i)=>thread(i+1))),'sample');assert.equal(many.rows.length,MAX_ROWS);
});

test('the answer: a parent Threads hides from this user leaves the row without one (to be filled in logged out); no threads at all, or errors with no data, is a failure',()=>{
 const hidden=[post({username:'sample',ms:T0-1000,text:'被藏起來的',hidden:true})];
 const r=parseReplies(repliesBody([thread(1),hidden]),'sample');
 assert.equal(r.ok,true);assert.equal(r.hidden,1);
 assert.deepEqual(r.rows[1],{id:hidden[0].pk,text:'被藏起來的',postedAt:new Date(hidden[0].taken_at*1000).toISOString(),url:`https://www.threads.com/@sample/post/${hidden[0].code}`,parentUrl:null,parentAuthor:null,isQuote:false,isRepost:false});
 assert.deepEqual(hiddenCodes(r.rows),[hidden[0].code]);
 assert.deepEqual(hiddenCodes(Array.from({length:PARENT_FILL_MAX+3},(_,i)=>({url:`https://www.threads.com/@sample/post/${codeAt(T0-i*1000)}`,parentUrl:null})).concat([{url:'x/post/Y',parentUrl:'p'}])).length,PARENT_FILL_MAX,'at most PARENT_FILL_MAX are filled in');
 // A reply whose answer names the author but the thread does not carry that post is hidden too (filled in the same way).
 const orphan=parseReplies(repliesBody([[post({username:'sample',ms:T0-500,reply:'ghost'})]]),'sample');
 assert.equal(orphan.rows[0].parentUrl,null);assert.equal(orphan.hidden,1);
 assert.deepEqual(parseReplies('for (;;);{"data":{"mediaData":{"edges":[],"page_info":{"has_next_page":false}}}}','sample'),{ok:true,rows:[],own:0,selfThread:0,hidden:0,errors:false},'an account with no replies');
 assert.deepEqual(parseReplies('{"errors":[{"message":"execution error"}]}','sample'),{ok:false,code:'QUERY'},'errors and no data: the query id is stale or refused');
 assert.deepEqual(parseReplies('<!doctype html>','sample'),{ok:false,code:'PARSE'});
 assert.deepEqual(parseReplies('{"data":{"user":null}}','sample'),{ok:false,code:'PARSE'},'an answer with no threads in it');
});

test('the logged-out post page: the parent the page shows everyone, none when it is gone for everyone, and a page without the reply',()=>{
 const parent=post({username:'hkj331155',ms:T0-90000,text:'上層'}),older=post({username:'hkj331155',ms:T0-900000,text:'更早的'}),later=post({username:'hkj331155',ms:T0+5000,text:'之後的'});
 const reply=post({username:'hkj315',ms:T0-60000,text:'留言',reply:'hkj331155'});
 const found=parentFromPostPage(postPageHtml(reply,[older,parent,reply,later]),reply.code,'HKJ315');
 assert.deepEqual(found,{found:true,parent:{url:`https://www.threads.com/@hkj331155/post/${parent.code}`,author:'hkj331155'}},'the latest of that author\'s posts before the reply');
 const gone=post({username:'maxyhwu',ms:T0-60000,text:'上層沒了'});
 assert.deepEqual(parentFromPostPage(postPageHtml(gone,[gone]),gone.code,'maxyhwu'),{found:true,parent:null},'reply_to_author null: gone for everyone');
 assert.deepEqual(parentFromPostPage(postPageHtml(reply,[reply]),reply.code,'hkj315'),{found:true,parent:null},'the author named but the post not in the thread');
 assert.deepEqual(parentFromPostPage(postPageHtml(reply,[parent,reply],{wall:true}),reply.code,'hkj315'),{found:false,parent:null},'a login wall');
 assert.deepEqual(parentFromPostPage(postPageHtml(reply,[parent,reply]),'OTHERCODE','hkj315'),{found:false,parent:null},'another post\'s page');
 const rows=[{url:`https://www.threads.com/@hkj315/post/${reply.code}`,parentUrl:null,parentAuthor:null,id:'1'},{url:'https://www.threads.com/@hkj315/post/AAAAAAA',parentUrl:null,parentAuthor:null,id:'2'}];
 const filled=withParent(rows,reply.code,found.parent);
 assert.equal(filled[0].parentAuthor,'hkj331155');assert.equal(filled[0].parentUrl,found.parent.url);assert.equal(filled[1].parentUrl,null);
 assert.deepEqual(withParent(rows,reply.code,null),rows,'nothing found: unchanged');
});

test('what is sent and counted: {rows} only, at least six; Threads refusals and the daily counters',()=>{
 const rows=[1,2,3,4,5,6].map(i=>thread(i)).map(t=>parseReplies(repliesBody([t]),'sample').rows[0]);
 assert.deepEqual(submission(rows),{rows});assert.equal(submission(rows.slice(0,5)),null);assert.equal(MIN_ROWS,6);
 assert.equal(submission(Array.from({length:40},()=>rows[0])).rows.length,MAX_ROWS);
 assert.equal(refused(429),true);assert.equal(refused(403),true);assert.equal(refused(500),false);assert.equal(refused(200),false);
 assert.equal(outcomeCounter('SENT'),'repliesSent');assert.equal(outcomeCounter('REFUSED'),'repliesRefused');
 for(const c of ['PARSE','QUERY','HIDDEN','TOO_FEW','NETWORK','TOKENS',undefined])assert.equal(outcomeCounter(c),'repliesFailed');
 assert.match(NOTICE,/登入狀態/);assert.match(NOTICE,/25 則/);assert.match(NOTICE,/Whospost/);
 assert.ok(record({user:{username:'A'},code:'DfFC8pqko24',pk:'1',taken_at:1}).url.endsWith('/@a/post/DfFC8pqko24'));
 assert.equal(record({user:{username:'a'},code:'bad code!'}),null);
});
