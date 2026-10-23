import test from 'node:test';
import assert from 'node:assert/strict';
import {LIST_VERSION,LIST_PATH,LIST_TTL,RETRY_AFTER,STALE_AFTER,parseList,emptyCache,listStatus,shouldRefresh,applyFetch,indexList} from '../../extension/lib/list.mjs';
import {LIST_VERSION as SERVER_VERSION} from '../../worker/account-list.mjs';
const H='a'.repeat(64),T0=Date.parse('2026-10-23T00:00:00Z');
const body=(accounts=[{h:H,score:4,hits:['content-comments'],assessed:5,unknown:1,evidence:'rules',ai:{summary:'一句。',version:'g'},scanId:'s1',updated:'2026-10-20T00:00:00Z',appeals:0}])=>({license:'CC BY-SA 4.0',attribution:'x',generated:'2026-10-23T00:00:00Z',version:LIST_VERSION,accounts});

test('the extension expects the version the Worker exports today, at the export path the Worker serves',()=>{
 assert.equal(LIST_VERSION,SERVER_VERSION);assert.equal(LIST_PATH,'/api/list/v1/export/threads-accounts.json');
});

test('parseList keeps the entry fields the extension draws and rejects another version, a bad shape or a bad hash',()=>{
 const p=parseList(body());
 assert.deepEqual(p.accounts[0],{h:H,score:4,hits:['content-comments'],assessed:5,unknown:1,evidence:'rules',ai:{summary:'一句。',version:'g'},scanId:'s1',updated:'2026-10-20T00:00:00Z',appeals:0});
 assert.equal(p.generated,'2026-10-23T00:00:00Z');
 assert.equal(parseList(body([{h:H,score:null}])).accounts[0].score,null,'checked, nothing to base a label on');
 assert.throws(()=>parseList({...body(),version:'signals-v3'}),/清單版本不符/);
 assert.throws(()=>parseList({accounts:'no'}),/清單格式不符/);
 assert.throws(()=>parseList(body([{h:'zuck'}])),/條目格式不符/,'a plain username is not a hash');
 assert.throws(()=>parseList(null),/清單格式不符/);
});

test('status: nothing fetched is missing; a fresh fetch is fresh; a later failure or two hours of silence make it stale',()=>{
 assert.equal(listStatus(null),'missing');assert.equal(listStatus(emptyCache()),'missing');
 const fresh=applyFetch(emptyCache(),{status:200,body:body(),etag:'"e1"'},T0);
 assert.equal(listStatus(fresh,T0+LIST_TTL),'fresh');
 assert.equal(listStatus(fresh,T0+STALE_AFTER+1),'stale','the background never managed to refresh');
 const failedLater=applyFetch(fresh,{status:404},T0+LIST_TTL);
 assert.equal(listStatus(failedLater,T0+LIST_TTL),'stale');
 assert.equal(failedLater.accounts.length,1,'the old list is kept');assert.equal(failedLater.failure,'HTTP 404');
 const renewed=applyFetch(failedLater,{status:304},T0+LIST_TTL+RETRY_AFTER);
 assert.equal(listStatus(renewed,T0+LIST_TTL+RETRY_AFTER),'fresh');assert.equal(renewed.failedAt,null);assert.equal(renewed.etag,'"e1"');
});

test('a 404 while the list API is switched off, a network error or an unparsable body all keep the cache missing, never throw',()=>{
 for(const outcome of [{status:404},{status:0,error:'Failed to fetch'},{status:200,body:{nope:true}},{status:500},{status:304}]){
  const c=applyFetch(emptyCache(),outcome,T0);
  assert.equal(listStatus(c,T0),'missing',JSON.stringify(outcome));assert.equal(c.failedAt,T0);assert.equal(c.accounts,null);
 }
 assert.equal(applyFetch(emptyCache(),{status:0,error:'Failed to fetch'},T0).failure,'Failed to fetch');
 assert.equal(applyFetch(emptyCache(),{status:200,body:{...body(),version:'old'}},T0).failure,'清單版本不符：old');
});

test('refresh is due after an hour, not within five minutes of a failure, and at once when nothing is held',()=>{
 assert.equal(shouldRefresh(null,T0),true);
 const fresh=applyFetch(emptyCache(),{status:200,body:body()},T0);
 assert.equal(shouldRefresh(fresh,T0+LIST_TTL-1),false);assert.equal(shouldRefresh(fresh,T0+LIST_TTL),true);
 const failed=applyFetch(emptyCache(),{status:404},T0);
 assert.equal(shouldRefresh(failed,T0+RETRY_AFTER-1),false);assert.equal(shouldRefresh(failed,T0+RETRY_AFTER),true);
});

test('indexList maps hash to entry for in-memory matching',()=>{
 const m=indexList(parseList(body()).accounts);
 assert.equal(m.get(H).score,4);assert.equal(m.get('b'.repeat(64)),undefined);assert.equal(indexList(null).size,0);
});
