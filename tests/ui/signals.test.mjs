import test from 'node:test';import assert from 'node:assert/strict';import {signalScore,topReplyTarget,norm,bare,common} from '../../shared/signals.mjs';
const rows=(n,kind,text='這是一段完整且相同的內容')=>Array.from({length:n},(_,i)=>({id:String(i),url:`https://www.threads.com/@test/post/p${i}`,parentUrl:`https://www.threads.com/@other/post/x${i}`,text,kind}));
const scan=(posts=[],comments=[],extra={})=>({account:{username:'test'},posts,comments,...extra});
const item=(s,id)=>s.items.find(r=>r.id===id);
const distinct=(n,kind)=>rows(n,kind).map((r,i)=>({...r,text:`第${i}則完全不同而且夠長的內容`}));
test('exact and similar posts are one dimension scored by share of posts',()=>{
 assert.equal(item(signalScore(scan(rows(5,'post'))),'content-posts').status,'unknown');
 assert.equal(item(signalScore(scan(rows(6,'post'))),'content-posts').contribution,1);
 const half=[...rows(3,'post'),...distinct(3,'post').map((r,i)=>({...r,url:r.url+'d'+i}))];assert.equal(item(signalScore(scan(half)),'content-posts').contribution,1);
 const less=[...rows(2,'post'),...distinct(4,'post').map((r,i)=>({...r,url:r.url+'d'+i}))];const s=item(signalScore(scan(less)),'content-posts');assert.equal(s.status,'no');assert.equal(s.detail,'2/6 篇貼文屬於相同或相似內容');
 const r=rows(5,'post');assert.equal(item(signalScore(scan([...r,r[0]])),'content-posts').status,'unknown');
});
test('short reactions count at 80 percent even when they are common greetings',()=>{
 assert.equal(item(signalScore(scan([],rows(20,'authored_reply','讚讚讚'))),'content-comments').contribution,1);
 const shortRows=n=>rows(n,'authored_reply','笑死').map((r,i)=>i<5?r:{...r,text:'好喔'});
 const mixed=[...shortRows(7),...distinct(3,'authored_reply').map((r,i)=>({...r,url:r.url+'d'+i}))];assert.equal(item(signalScore(scan([],mixed)),'content-comments').contribution,0);
 const eight=[...shortRows(8),...distinct(2,'authored_reply').map((r,i)=>({...r,url:r.url+'d'+i}))];assert.equal(item(signalScore(scan([],eight)),'content-comments').contribution,1);
});
test('more than ten distinct parents with author majority adds one, not per message',()=>{const s=signalScore(scan([],distinct(11,'authored_reply')));assert.equal(item(s,'author-focus').contribution,1);assert.equal(item(s,'thread-focus').contribution,0)});
test('single parent threshold is strict and separate from distinct parents',()=>{const r=distinct(11,'authored_reply').map(x=>({...x,parentUrl:'https://www.threads.com/@other/post/one'}));const s=signalScore(scan([],r));assert.equal(item(s,'thread-focus').contribution,1);assert.equal(item(s,'author-focus').contribution,0)});
test('mutual focus needs the partner saved scan and is unknown without it',()=>{
 const c=distinct(8,'authored_reply');
 assert.equal(item(signalScore(scan([],c)),'mutual-focus').status,'unknown');
 assert.equal(item(signalScore(scan([],c,{mutual:{partner:'other',scanned:false}})),'mutual-focus').detail,'@other 尚未查詢，無法確認是否互相集中');
 assert.equal(item(signalScore(scan([],c,{mutual:{partner:'other',scanned:true,partnerTopAuthor:'test',partnerShare:.75}})),'mutual-focus').contribution,1);
 assert.equal(item(signalScore(scan([],c,{mutual:{partner:'other',scanned:true,partnerTopAuthor:'someone',partnerShare:.9}})),'mutual-focus').status,'no');
 const spread=c.map((r,i)=>({...r,parentUrl:`https://www.threads.com/@a${i}/post/x${i}`}));assert.equal(item(signalScore(scan([],spread)),'mutual-focus').status,'no');
 assert.deepEqual(topReplyTarget(scan([],c)),{author:'other',count:8,known:8,share:1,complete:true});
});
test('burst counts consecutive replies under the same post within ten seconds',()=>{
 const t=s=>new Date(Date.UTC(2026,0,1,0,0,s)).toISOString();
 const same=distinct(6,'authored_reply').map((r,i)=>({...r,parentUrl:'https://www.threads.com/@other/post/one',postedAt:t(i*5)}));assert.equal(item(signalScore(scan([],same)),'burst-replies').contribution,1);
 const apart=same.map((r,i)=>({...r,postedAt:t(i*30)}));assert.equal(item(signalScore(scan([],apart)),'burst-replies').contribution,0);
 const crossThread=distinct(6,'authored_reply').map((r,i)=>({...r,postedAt:t(i*5)}));assert.equal(item(signalScore(scan([],crossThread)),'burst-replies').contribution,0);
});
test('sample insufficient is unknown, not confirmed absence',()=>{assert.equal(signalScore(scan()).value,null);assert.equal(item(signalScore(scan(rows(5,'post'))),'content-posts').detail,'只取得 5 篇貼文，至少 6 篇才能判讀')});
test('comment content uses every authored reply when the scan kept them',()=>{
 const withParent=rows(6,'authored_reply').map((r,i)=>({...r,text:`第${i}則完全不同而且夠長的內容`}));
 const all=[...withParent,...rows(30,'authored_reply','笑死').map((r,i)=>({...r,url:r.url+'a'+i,parentUrl:null}))];
 const s=item(signalScore(scan([],withParent,{authoredReplies:all})),'content-comments');assert.equal(s.contribution,1);assert.match(s.detail,/30\/36 則在 4 字以內/);
 assert.equal(item(signalScore(scan([],withParent)),'content-comments').contribution,0);
});
test('norm, bare and common are exported for the browser extension; their behaviour is unchanged',()=>{
 for(const fn of [norm,bare,common])assert.equal(typeof fn,'function');
 assert.equal(norm('  讚 　讚  '),'讚 讚','NFKC folds the full-width space, runs of whitespace collapse, ends are trimmed');
 assert.equal(bare('讚！讚。'),'讚讚','punctuation and symbols are dropped');
 assert.equal(common('讚讚'),true);
 assert.equal(common('讚讚！'),true);
 assert.equal(common('這是一段完整且相同的內容'),false);
 assert.equal(common(''),false);
});
