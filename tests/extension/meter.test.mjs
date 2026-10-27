import test from 'node:test';
import assert from 'node:assert/strict';
import {meter,meterText,HOUR_MS} from '../../extension/lib/meter.mjs';

// 12:40 Taipei: the clock hour began 40 minutes ago and resets in 20.
const hour=Date.UTC(2026,9,26,4,0,0),now=hour+40*60000,ago=min=>now-min*60000;

test('meter: nothing used this clock hour → all left, says it resets on the hour',()=>{
 for(const usage of [undefined,null,{},{stamps:[]},{stamps:[ago(41),ago(90)]}]){
  const m=meter(usage,10,now);
  assert.deepEqual(m,{used:0,limit:10,remaining:10,pct:0,level:'ok',resetAt:hour+HOUR_MS});
  assert.deepEqual(meterText(m,now),{right:'0/10',caption:'每小時 10 次，整點重設'});
 }
});

test('meter: the clock hour (Felix 10-27) — only presses since the hour began count; it says when it resets',()=>{
 const m=meter({stamps:[ago(5),ago(18),ago(39),ago(42)]},10,now);
 assert.equal(m.used,3);assert.equal(m.remaining,7);assert.equal(m.pct,30);assert.equal(m.level,'ok');
 assert.equal(m.resetAt,hour+HOUR_MS);
 assert.deepEqual(meterText(m,now),{right:'3/10',caption:'還剩 7 次 · 20 分鐘後重設'});
});

test('meter: 80% or more is high; all used is full and says so',()=>{
 assert.equal(meter({stamps:Array.from({length:48},(_,i)=>ago(i/2))},60,now).level,'high');
 const full=meter({stamps:Array.from({length:10},(_,i)=>ago(i*3+1))},10,now);
 assert.equal(full.level,'full');assert.equal(full.remaining,0);
 assert.deepEqual(meterText(full,now),{right:'10/10',caption:'這小時用完了 · 20 分鐘後重設'});
});

test('meter: never below one minute, never more used than the limit, future stamps ignored',()=>{
 const late=hour+HOUR_MS-1000;
 assert.match(meterText(meter({stamps:[late-5000]},10,late),late).caption,/1 分鐘後重設/);
 assert.equal(meter({stamps:Array.from({length:12},(_,i)=>ago(i))},10,now).used,10);
 assert.equal(meter({stamps:[now+60000,'x',NaN]},10,now).used,0);
});
