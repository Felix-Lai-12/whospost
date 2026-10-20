import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../../server/store.mjs';
import {createApi} from '../../server/api.mjs';
import {collectionProfile} from '../../server/collection-profile.mjs';

const hash='a'.repeat(64),token='0123456789abcdef0123456789abcdef';
const api=(store,extra={})=>createApi({store,profile:collectionProfile('standard'),startRun:()=>{},...extra});
const post=(body,{headers={},...init}={})=>new Request('https://whospost.example/api/pledge',{method:'POST',headers:{'content-type':'application/json',...headers},body:typeof body==='string'?body:JSON.stringify(body),...init});

test('pledge(): the first hash counts, the same hash again answers already, each hash counts once',()=>{
 const store=new Store(':memory:',{budgetLimitUsd:1});
 assert.deepEqual(store.pledgeCount().count,0);
 assert.deepEqual(store.pledge(hash),{result:'counted',count:1});
 assert.deepEqual(store.pledge(hash),{result:'already',count:1});
 assert.deepEqual(store.pledge('b'.repeat(64)),{result:'counted',count:2});
 assert.deepEqual(store.pledge(hash),{result:'already',count:2});
 const {count,updatedAt}=store.pledgeCount();assert.equal(count,2);assert.match(updatedAt,/^\d{4}-\d{2}-\d{2}T/);
 store.close();
});

test('site-wide pledges per minute: the limit blocks the next new pledge, repeats do not count, the next minute resets, 0 disables',()=>{
 let now=60000;
 const store=new Store(':memory:',{budgetLimitUsd:1,pledgeRatePerMin:2,now:()=>now});
 assert.equal(store.pledge('1'.repeat(64)).result,'counted');
 assert.equal(store.pledge('1'.repeat(64)).result,'already','a repeat never spends the bucket');
 assert.equal(store.pledge('2'.repeat(64)).result,'counted');
 assert.deepEqual(store.pledge('3'.repeat(64)),{result:'rate_limited',count:2});
 assert.equal(store.pledgeCount().count,2,'a refused pledge is not stored');
 now=120000;assert.equal(store.pledge('3'.repeat(64)).result,'counted');
 store.close();
 const open=new Store(':memory:',{budgetLimitUsd:1,pledgeRatePerMin:0});
 for(let i=0;i<10;i++)assert.equal(open.pledge(String(i).repeat(64)).result,'counted');
 open.close();
 assert.throws(()=>new Store(':memory:',{budgetLimitUsd:1,pledgeRatePerMin:-1}),/Invalid pledge rate/);
});

test('POST /api/pledge: a valid token is counted once; the database holds only the SHA-256 and an ISO time',async()=>{
 const store=new Store(':memory:',{budgetLimitUsd:1}),handle=api(store);
 const first=await handle(post({token}));
 assert.equal(first.status,200);assert.deepEqual(await first.json(),{result:'counted',count:1});
 assert.equal(first.headers.get('cache-control'),'no-store','the POST answer is the real count, never cached');
 const again=await handle(post({token}));
 assert.deepEqual(await again.json(),{result:'already',count:1});
 const rows=store.db.prepare('SELECT token_hash,created_at FROM pledges').all();
 assert.equal(rows.length,1);
 assert.match(rows[0].token_hash,/^[a-f0-9]{64}$/);assert.notEqual(rows[0].token_hash,token);assert.equal(rows[0].token_hash.includes(token),false);
 assert.match(rows[0].created_at,/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
 const get=await handle(new Request('https://whospost.example/api/pledge'));
 assert.equal(get.status,200);assert.equal(get.headers.get('cache-control'),'public, max-age=60');
 const body=await get.json();assert.equal(body.count,1);assert.deepEqual(Object.keys(body).sort(),['count','updatedAt']);
 store.close();
});

test('POST /api/pledge refuses bad input: 400 format, 415 content type, 413 size, 403 foreign origin, 405 other methods',async()=>{
 const store=new Store(':memory:',{budgetLimitUsd:1}),handle=api(store);
 for(const body of [{},{token:'short'},{token:token.toUpperCase()},{token,extra:1},{token:123},[token],'null','"x"','{'])assert.equal((await handle(post(body))).status,400,JSON.stringify(body));
 assert.equal((await handle(post({token},{headers:{'content-type':'text/plain'}}))).status,415);
 assert.equal((await handle(post(JSON.stringify({token,pad:'x'.repeat(300)})))).status,413);
 assert.equal((await handle(post({token},{headers:{origin:'https://evil.example'}}))).status,403);
 assert.equal((await handle(post({token},{headers:{origin:'https://whospost.example'}}))).status,200,'same origin passes');
 assert.equal((await handle(new Request('https://whospost.example/api/pledge',{method:'PUT'}))).status,405);
 assert.equal(store.pledgeCount().count,1,'only the one valid request counted');
 store.close();
});

test('a site-wide rate refusal is a 429 with the current count, and the gate runs before anything is stored',async()=>{
 const store=new Store(':memory:',{budgetLimitUsd:1,pledgeRatePerMin:1}),calls=[];
 const handle=api(store,{pledgeGate:async r=>{calls.push(r.headers.get('x-test'));return r.headers.get('x-test')==='deny'?{response:new Response('denied',{status:429})}:{};}});
 assert.equal((await handle(post({token}))).status,200);
 const limited=await handle(post({token:'f'.repeat(32)}));
 assert.equal(limited.status,429);assert.deepEqual(await limited.json(),{code:'RATE_LIMITED',error:'登記的人太多了，請一分鐘後再試。',count:1});
 const denied=await handle(post({token:'e'.repeat(32)},{headers:{'x-test':'deny'}}));
 assert.equal(denied.status,429);assert.equal(await denied.text(),'denied');
 assert.deepEqual(calls,[null,null,'deny']);
 assert.equal(store.pledgeCount().count,1);
 store.close();
});
