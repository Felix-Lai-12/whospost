import test from 'node:test';
import assert from 'node:assert/strict';
import {meter,meterText,HOUR_MS} from '../../extension/lib/meter.mjs';

const now=Date.UTC(2026,9,26,4,0,0),ago=min=>now-min*60000;

test('meter: nothing used → the whole hour left, no bar, says it has not been used',()=>{
 for(const usage of [undefined,null,{},{stamps:[]},{stamps:[ago(61),ago(90)]}]){
  const m=meter(usage,10,now);
  assert.deepEqual(m,{used:0,limit:10,remaining:10,pct:0,level:'ok',backAt:null});
  assert.deepEqual(meterText(m,now),{right:'0/10',caption:'每小時 10 次，這小時還沒用'});
 }
});

test('meter: a rolling hour — the oldest press inside it is the next one back',()=>{
 const m=meter({stamps:[ago(5),ago(18),ago(42),ago(70)]},10,now);
 assert.equal(m.used,3);assert.equal(m.remaining,7);assert.equal(m.pct,30);assert.equal(m.level,'ok');
 assert.equal(m.backAt,ago(42)+HOUR_MS);
 assert.deepEqual(meterText(m,now),{right:'3/10',caption:'還剩 7 次 · 18 分鐘後回來 1 次'});
});

test('meter: 80% or more is high; all used is full and says so',()=>{
 assert.equal(meter({stamps:Array.from({length:48},(_,i)=>ago(i))},60,now).level,'high');
 const full=meter({stamps:Array.from({length:10},(_,i)=>ago(i*5+1))},10,now);
 assert.equal(full.level,'full');assert.equal(full.remaining,0);
 assert.deepEqual(meterText(full,now),{right:'10/10',caption:'這小時用完了 · 14 分鐘後回來 1 次'});
});

test('meter: never below one minute, never more used than the limit, future stamps ignored',()=>{
 assert.match(meterText(meter({stamps:[ago(59.99)]},10,now),now).caption,/1 分鐘後回來/);
 assert.equal(meter({stamps:Array.from({length:12},(_,i)=>ago(i))},10,now).used,10);
 assert.equal(meter({stamps:[now+60000,'x',NaN]},10,now).used,0);
});
