// Replies the extension reads in the user's browser (plan-extension-replies 2026-10-29), P0 shadow mode: the rows check
// themselves (shared/reply-rows.mjs), the server spot-checks them logged out (server/reply-check.mjs), and the route
// keeps them for the admin's comparison with the scan's own result, from the requesting address only (worker/ext-replies.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {collectionProfile} from '../../server/collection-profile.mjs';
import {StoreObjectCore,BACKUP_TABLES} from '../../worker/store-object.mjs';
import {createWorkerApp} from '../../worker/app.mjs';
import {codeToId,codeTime,checkReplyRows,postLink} from '../../shared/reply-rows.mjs';
import {readPost,spotCheck} from '../../server/reply-check.mjs';
import {analyze} from '../../server/analysis.mjs';

const ALPHABET='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
// A post code for a time, the way Threads makes one: the id is (ms since 2011-08-24) << 23 plus a sequence.
const codeAt=(ms,seq=1)=>{let n=(BigInt(ms-1314220021721)<<23n)|BigInt(seq),s='';while(n>0n){s=ALPHABET[Number(n%64n)]+s;n/=64n;}return s;};
const T0=Date.UTC(2026,9,28,12,0,0);
// One reply by `who`, `i` minutes after T0, under a post by `parent` (null: a reply whose parent Threads did not show).
// Each account's codes get their own sequence numbers, so two accounts' replies at the same minute stay distinct posts.
const reply=(who,i,text,parent='star')=>{
 const seq=[...who].reduce((n,c)=>n*31+c.charCodeAt(0),0)%100000*1000;
 const at=T0+i*60000,code=codeAt(at,seq+i+1),p=parent&&codeAt(at-3600000,seq+i+101);
 return {id:codeToId(code),text,postedAt:new Date(at).toISOString(),url:`https://www.threads.com/@${who}/post/${code}`,parentUrl:p?`https://www.threads.com/@${parent}/post/${p}`:null,parentAuthor:parent,isQuote:false,isRepost:false};
};
const rowsOf=(who,texts,parent)=>texts.map((t,i)=>reply(who,i,t,parent));

test('a post code is its id in base 64, and the id carries the second it was posted (checked on three real replies)',()=>{
 for(const [code,id,at] of [['DfD1Tamjzk7','4018289723243968827','2026-10-29T01:31:24Z'],['DfDcdggk6wK','4018180465618037770','2026-10-28T21:54:20Z'],['DfCgOiOj4KL','4017915553880441483','2026-10-28T13:08:00Z']]){
  assert.equal(codeToId(code),id);
  assert.ok(Math.abs(codeTime(code)-Date.parse(at))<1000,code);
 }
 assert.equal(codeToId('ab'),null);assert.equal(codeToId('bad code!'),null);assert.equal(codeTime(null),null);
 assert.deepEqual(postLink('https://www.threads.com/@peacehu1213/post/DfD1Tamjzk7'),{author:'peacehu1213',code:'DfD1Tamjzk7'});
 for(const u of ['https://www.threads.net/@a/post/DfD1Tamjzk7','https://www.threads.com/@a/post/DfD1Tamjzk7?x=1','http://www.threads.com/@a/post/DfD1Tamjzk7','https://www.threads.com/@A/post/DfD1Tamjzk7'])assert.equal(postLink(u),null,u);
 assert.equal(codeTime(codeAt(T0)),T0,'the test encoder agrees with the decoder');
});

test('checkReplyRows: the rows must agree with themselves, so made-up ids, times, authors or parents fail for free',()=>{
 const good=rowsOf('sample',['一','二','三','四','五','六']);
 assert.deepEqual(checkReplyRows(good,'Sample',T0+86400000),{ok:true,rows:good,dropped:[]});
 assert.equal(checkReplyRows([...good.slice(0,5),reply('sample',5,'六',null)],'sample',T0+86400000).ok,true,'a reply without a visible parent is kept (probe: hkj315)');
 const bad=(why,rows,code,now=T0+86400000)=>{const r=checkReplyRows(rows,'sample',now);assert.equal(r.ok,false,why);assert.equal(r.code,code,why);};
 const swap=(i,patch)=>good.map((r,j)=>j===i?{...r,...patch}:r);
 bad('not a list',{rows:good},'INVALID_ROWS');
 bad('five rows',good.slice(0,5),'TOO_FEW_REPLIES');
 bad('31 rows',rowsOf('sample',Array.from({length:31},(_,i)=>`第${i}則`)),'TOO_MANY_REPLIES');
 bad('an extra key',swap(2,{likes:3}),'INVALID_ROW');
 bad('a missing key',good.map(({isRepost,...r})=>r),'INVALID_ROW');
 bad('text too long',swap(0,{text:'字'.repeat(1001)}),'INVALID_ROW');
 bad('someone else\'s reply',[...good.slice(0,5),reply('other',5,'六')],'NOT_TARGET_AUTHOR');
 bad('an id that is not its code',swap(1,{id:'123'}),'ID_NOT_CODE');
 bad('the same reply twice',[...good.slice(0,5),good[0]],'DUPLICATE_ID');
 // A time off its code drops that row (Felix 10-30: Apify's own rows had one in fifteen off by 38 s), the rest are kept;
 // with only six rows the drop leaves too few.
 const seven=rowsOf('sample',['一','二','三','四','五','六','七']),off=checkReplyRows(seven.map((r,j)=>j===3?{...r,postedAt:new Date(T0-86400000).toISOString()}:r),'sample',T0+86400000);
 assert.equal(off.ok,true);assert.deepEqual(off.dropped,[{index:3,code:'TIME_NOT_CODE'}]);assert.deepEqual(off.rows.map(r=>r.text),['一','二','三','五','六','七']);
 bad('a time the code does not carry, leaving five',swap(3,{postedAt:new Date(T0-86400000).toISOString()}),'TOO_FEW_REPLIES');
 bad('a time that is not a time',swap(3,{postedAt:'yesterday'}),'TIME_NOT_CODE');
 bad('a reply from the future',good,'FUTURE_TIME',T0);
 bad('a parent without an author',swap(4,{parentAuthor:null}),'INVALID_PARENT');
 bad('a parent author the link does not name',swap(4,{parentAuthor:'nobody'}),'INVALID_PARENT');
 bad('a parent posted after the reply',swap(5,{parentUrl:`https://www.threads.com/@star/post/${codeAt(T0+86400000)}`}),'PARENT_AFTER_REPLY');
 assert.equal(checkReplyRows(good,'Not A Name',T0+86400000).code,'INVALID_TARGET');
});

// A logged-out Threads, as measured on 2026-10-29: a reply's page names its author and code in og:url and carries its
// text in og:description (none when there is no text); a made-up code goes to /?error=invalid_post; a code under the
// wrong author goes to the right one; a walled egress goes to the login page.
function fakeThreads(posts,{wall=false}={}){
 const calls=[];
 const page=(url,text)=>`<html><head><meta property="og:url" content="${url.replace('@','&#064;')}" />${text?`<meta property="og:description" content="${text.replace(/[^\x20-\x7e]/gu,c=>`&#x${c.codePointAt(0).toString(16)};`)}" />`:''}</head></html>`;
 const fetchImpl=async(url,init)=>{
  calls.push(url);assert.equal(init.redirect,'manual');assert.match(init.headers['User-Agent'],/Whospost/);
  if(wall)return new Response(null,{status:302,headers:{location:'https://www.threads.com/login'}});
  const link=postLink(url),real=[...posts.values()].find(p=>postLink(p.url).code===link?.code);
  if(!real)return new Response(null,{status:302,headers:{location:'https://www.threads.com/?error=invalid_post'}});
  if(real.url!==url)return new Response(null,{status:301,headers:{location:real.url}});
  return new Response(page(real.url,real.text),{status:200,headers:{'content-type':'text/html'}});
 };
 return {fetchImpl,calls};
}

test('spotCheck: picked rows are read again logged out; a missing post, another author or other words fail, a login wall leaves it unverifiable',async()=>{
 const rows=rowsOf('sample',['今天天氣很好 & 你好','第二則','','第四則','第五則','第六則']);
 const real=new Map(rows.map(r=>[r.id,r]));
 const first=()=>0;
 assert.deepEqual(await spotCheck(rows,{...fakeThreads(real),random:first}),{verification:'passed',checked:[{id:rows[0].id,result:'match'},{id:rows[1].id,result:'match'}]});
 assert.equal((await readPost(rows[2].url,fakeThreads(real))).text,'','a reply with no text has no og:description');
 const {fetchImpl,calls}=fakeThreads(real);
 assert.equal((await spotCheck(rows,{fetchImpl,picks:6})).verification,'passed');assert.equal(calls.length,6);
 const edited=rows.map((r,i)=>i===0?{...r,text:'今天天氣很好 & 你好 加一句'}:r);
 assert.equal((await spotCheck(edited,{...fakeThreads(real),random:first})).checked[0].result,'text_differs');
 const madeUp=[reply('sample',30,'沒這則'),...rows.slice(1)];
 assert.deepEqual((await spotCheck(madeUp,{...fakeThreads(real),random:first})),{verification:'failed',checked:[{id:madeUp[0].id,result:'missing'},{id:rows[1].id,result:'match'}]});
 const moved=new Map(real);moved.set(rows[0].id,{...rows[0],url:rows[0].url.replace('@sample','@someone')});
 assert.equal((await spotCheck(rows,{...fakeThreads(moved),random:first})).checked[0].result,'missing','another author\'s post is redirected there');
 assert.deepEqual(await spotCheck(rows,{...fakeThreads(real,{wall:true}),random:first}),{verification:'unverifiable',checked:[{id:rows[0].id,result:'unknown'},{id:rows[1].id,result:'unknown'}]});
 assert.equal((await spotCheck(rows,{fetchImpl:async()=>{throw new Error('offline');},random:first})).verification,'unverifiable');
});

function fakeStorage(){
 const db=new DatabaseSync(':memory:');
 return {sql:{exec(text,...params){const rows=db.prepare(text).all(...params);return {toArray:()=>rows,one:()=>rows[0]};}},
  transactionSync(fn){db.exec('BEGIN');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}},setAlarm(){},async get(){},async put(){},async delete(){}};
}
const ENV={WHOSPOST_APIFY_LIMIT_USD:'2',WHOSPOST_DAILY_LIMIT_USD:'1',WHOSPOST_AI_LIMIT_USD:'1',GEMINI_API_KEY:'fixture-key',IP_HASH_SALT:'salt',ADMIN_TOKEN:'admin',WHOSPOST_EXTENSION_IDS:'a'.repeat(32)};
const SITE='https://whospost.example',EXT=`chrome-extension://${'a'.repeat(32)}`;
const TOPICS=['今天早上去市場買菜，發現高麗菜又漲價了','週末帶小孩去動物園看企鵝，人潮比想像中少','新買的咖啡豆偏酸，下次想換深焙的試試看','颱風假在家追劇，一口氣看完整季推理影集','公司樓下新開的拉麵店湯頭很濃，值得排隊','跑步第三個月終於能一口氣跑完五公里了'];
const posts=u=>TOPICS.map((text,i)=>({id:`p${i}`,author:u,kind:'post',text,postedAt:'2026-10-20T00:00:00Z',url:`https://www.threads.com/@${u}/post/p${i}`,source:'automation-lab/threads-scraper'}));
// Saved scans the extension's 「AI 打詐」 is answered with: Apify found eight one-word replies on eight threads (the
// short-replies signal hits) for both accounts. The replies the extension sends: the same eight for `same`, eight long
// different ones for `differs`.
function world({env={},real=new Map(),keys=[]}={}){
 const t={now:T0+86400000};
 const core=new StoreObjectCore({storage:fakeStorage()},ENV,{prompt:'fixture prompt',now:()=>t.now});
 const threads=fakeThreads(real);
 const app=createWorkerApp({...ENV,WHOSPOST_EXTENSION_REPLIES:'1',ASSETS:{fetch:async()=>new Response('')},EXT_SCAN_RATE_LIMITER:{limit:async()=>({success:true})},SCAN_RATE_LIMITER:{limit:async({key})=>{keys.push(key);return {success:true};}},...env},{storeStub:core,startScan:()=>{},fetchImpl:threads.fetchImpl,now:()=>t.now});
 const scans={};
 for(const u of ['same','differs']){
  const s=core.store.create(u);
  const apify=Array.from({length:8},(_,i)=>({...reply(u,i,'好'),author:u,kind:'authored_reply',isReply:true,source:'benthepythondev/threads-user-posts-scraper',parentUrl:`https://www.threads.com/@p${i}/post/${codeAt(T0-3600000,i+101)}`,parentAuthor:`p${i}`}));
  // Saved the way scan-runner saves a finished scan: the analysed bundle.
  const account={username:u};
  core.store.update(s.id,{...analyze({account,posts:posts(u),comments:apify,comparison:[],comparedTargetIds:[],commentsAvailable:true,limitations:[]}),account,status:'completed',completedAt:new Date(T0).toISOString()});
  scans[u]=s;
 }
 const ask=(username,ip='198.51.100.1',headers={Origin:EXT})=>app(new Request(`${SITE}/api/scans`,{method:'POST',headers:{'Content-Type':'application/json','cf-connecting-ip':ip,...headers},body:JSON.stringify({url:`https://www.threads.com/@${username}`})}));
 const send=(id,body,ip='198.51.100.1',headers={Origin:EXT})=>app(new Request(`${SITE}/api/scans/${id}/replies`,{method:'POST',headers:{'Content-Type':'application/json','cf-connecting-ip':ip,...headers},body:typeof body==='string'?body:JSON.stringify(body)}));
 const summary=async()=>(await app(new Request(`${SITE}/api/admin/ext-replies`,{method:'POST',headers:{authorization:'Bearer admin'}}))).json();
 return {core,app,t,threads,scans,ask,send,summary};
}
const sameRows=rowsOf('same',Array(8).fill('好'),null).map((r,i)=>({...r,parentUrl:`https://www.threads.com/@p${i}/post/${codeAt(T0-3600000,i+101)}`,parentAuthor:`p${i}`}));
const differsRows=rowsOf('differs',Array.from({length:8},(_,i)=>`第 ${i} 則認真的長留言，每一則都寫得不一樣`));

test('POST /api/scans/:id/replies: behind the replies switch, from the extension, only from the address that asked for that scan, and nothing is fetched before that is known',async()=>{
 const real=new Map([...sameRows,...differsRows].map(r=>[r.id,r])),keys=[];
 const {core,scans,ask,send,threads,app}=world({real,keys});
 const id=scans.same.id,body={rows:sameRows};
 const off=world({env:{WHOSPOST_EXTENSION_REPLIES:'0'}});
 assert.equal((await off.send(off.scans.same.id,body)).status,404,'switch off: no route');
 assert.equal((await send(id,body,'198.51.100.1',{})).status,403,'no extension origin');
 const pre=await app(new Request(`${SITE}/api/scans/${id}/replies`,{method:'OPTIONS',headers:{Origin:EXT}}));
 assert.equal(pre.status,204);assert.equal(pre.headers.get('access-control-allow-origin'),EXT);
 const notAsked=await send(id,body);assert.equal(notAsked.status,403);assert.equal((await notAsked.json()).code,'NOT_REQUESTER');
 assert.equal(threads.calls.length,0,'a caller that may not submit never makes the server fetch');
 assert.equal((await send('00000000-0000-0000-0000-000000000000',body)).status,404);
 await ask('same');
 // Over 64 KB is refused by bytes read, not by Content-Length or string length (CodeRabbit on #92): a streamed body
 // carries no Content-Length and is stopped at the limit, before parsing or any fetch.
 const huge=JSON.stringify({rows:sameRows.map(r=>({...r,text:'好'.repeat(3000)}))});
 assert.ok(huge.length<65536&&new TextEncoder().encode(huge).byteLength>65536,'under the limit in UTF-16 units, over it in bytes');
 const streamed=await app(new Request(`${SITE}/api/scans/${id}/replies`,{method:'POST',headers:{'Content-Type':'application/json','cf-connecting-ip':'198.51.100.1',Origin:EXT},body:new Blob([huge]).stream(),duplex:'half'}));
 assert.equal(streamed.status,413,'an oversized body without Content-Length');
 assert.equal(threads.calls.length,0,'nothing fetched for a refused body');
 assert.equal((await send(id,body,'198.51.100.9')).status,403,'another address cannot ride on that request');
 assert.equal((await send(scans.differs.id,{rows:differsRows})).status,403,'asking for one account does not open another');
 for(const bad of ['{',{rows:sameRows,extra:1},{rows:sameRows.slice(0,5)},{rows:[...sameRows.slice(1),differsRows[0]]}])assert.equal((await send(id,bad)).status,400,JSON.stringify(bad).slice(0,60));
 assert.equal(threads.calls.length,0,'a submission that fails its own checks is not spot-checked');
 const ok=await send(id,body);assert.equal(ok.status,200);
 assert.deepEqual(await ok.json(),{ok:true},'the answer does not say how the spot check went');
 assert.equal(ok.headers.get('access-control-allow-origin'),EXT);
 assert.equal(threads.calls.length,2,'two rows read again');
 const row=core.store.db.prepare('SELECT * FROM ext_replies').get();
 assert.equal(row.username,'same');assert.equal(row.verification,'passed');assert.match(row.reporter,/^[a-f0-9]{32}$/,'no raw address');
 assert.equal((await send(id,body)).status,200);
 assert.equal(core.store.db.prepare('SELECT COUNT(*) AS n FROM ext_replies').get().n,1,'one row per scan and address: a repeat replaces it');
 assert.ok(keys.some(k=>k==='replies:198.51.100.1'),'the per-IP limiter, under its own key');
 assert.ok(BACKUP_TABLES.has('ext_replies'));
 // Shadow mode: the scan, its view and the list are exactly what Apify gave.
 assert.equal(core.store.get(id).comments[0].source,'benthepythondev/threads-user-posts-scraper');
});

test('the admin summary scores each submission next to its scan: agreement signal by signal, spot-check outcomes, scans still running',async()=>{
 const forged=differsRows.map((r,i)=>i<1?r:{...r,text:`${r.text}（改過）`});
 const real=new Map([...sameRows,...forged].map(r=>[r.id,r]));
 const {core,scans,ask,send,summary}=world({real});
 const sameId=scans.same.id,differsId=scans.differs.id;
 await ask('same');await ask('differs');
 // A scan still running, asked for from this address (the gate here has no Apify token, so it is bound in the store,
 // under the hash the route computes: the salted address).
 const running=core.store.create('later');core.store.update(running.id,{status:'running'});
 core.store.requestScan('later',collectionProfile('standard'),{source:'extension',reporter:createHash('sha256').update('salt:profile:198.51.100.1').digest('hex').slice(0,32)});
 assert.equal((await send(sameId,{rows:sameRows})).status,200);
 assert.equal((await send(differsId,{rows:differsRows})).status,200,'taken, though its words differ from Threads\'');
 const laterRows=rowsOf('later',['一','二','三','四','五','六']);
 assert.equal((await send(running.id,{rows:laterRows})).status,200,'a scan still running is taken and compared once it ends');
 const s=await summary();
assert.equal(s.submissions,3);assert.equal(s.replies,22);
 assert.deepEqual(s.verification,{passed:1,failed:2,unverifiable:0},'differs: of any two rows picked, one reads differently on Threads; later: Threads has no such posts');
 assert.equal(s.compared,2);assert.equal(s.pending,1);assert.equal(s.agreeing,1);assert.equal(s.agreementRate,.5);
 const same=s.recent.find(r=>r.username==='same'),differs=s.recent.find(r=>r.username==='differs');
 assert.deepEqual([same.apify,same.ext,same.agree],[['content-comments'],['content-comments'],true]);
 assert.deepEqual([differs.apify,differs.ext,differs.agree],[['content-comments'],[],false]);
 assert.deepEqual(s.bySignal['content-comments'],{'yes→yes':1,'yes→no':1});
 assert.equal(s.recent.find(r=>r.username==='later').pending,true);
 assert.equal(core.store.scanView(differsId).score.items.find(i=>i.id==='content-comments').status,'yes','the scan itself is untouched');
});
