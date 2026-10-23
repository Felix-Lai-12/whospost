import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {sha256Hex,hashUsername,createHashCache} from '../../extension/lib/hash.mjs';
import {hashUsername as serverHash} from '../../worker/account-list.mjs';

test('the extension hashes a username exactly as the list builder does: sha256 of the lowercase name',async()=>{
 assert.equal(await hashUsername('Sample_Hit'),createHash('sha256').update('sample_hit').digest('hex'));
 assert.equal(await hashUsername('Sample_Hit'),await serverHash('sample_hit'));
 assert.match(await sha256Hex('zuck'),/^[a-f0-9]{64}$/);
});

test('the hash cache answers the same account from one promise and evicts the least recently used entry',async()=>{
 let calls=0;
 const cache=createHashCache({max:2,hash:async u=>{calls++;return `h:${u}`;}});
 const a=cache.hash('A'),b=cache.hash('a');
 assert.equal(a,b,'case-insensitive, same promise');assert.equal(await a,'h:a');assert.equal(calls,1);
 cache.hash('b');assert.equal(cache.size,2);
 cache.hash('a');          // touch a: b is now the oldest
 cache.hash('c');          // evicts b
 assert.equal(cache.size,2);
 cache.hash('a');assert.equal(calls,3,'a and c computed once, b once');
 cache.hash('b');assert.equal(calls,4,'b was evicted and is computed again');
});
