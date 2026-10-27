import test from 'node:test';
import assert from 'node:assert/strict';
import {meter,meterText,usageWindow,recordUse,HOUR_MS} from '../../extension/lib/meter.mjs';

const now=Date.UTC(2026,9,26,4,40,0),ago=min=>now-min*60000;

test('meter: nothing used → all left, says the hour starts with the first use',()=>{
 for(const usage of [undefined,null,{},{stamps:[]},{stamps:[ago(61),ago(90)]},{start:ago(61),count:3,last:ago(61)}]){
  const m=meter(usage,10,now);
  assert.deepEqual(m,{used:0,limit:10,remaining:10,pct:0,level:'ok',resetAt:null});
  assert.deepEqual(meterText(m,now),{right:'0/10',caption:'每小時 10 次，從第一次用起算'});
 }
});

test('meter: the hour begins with the first use and resets an hour later (Felix 10-27)',()=>{
 const m=meter({start:ago(40),count:3,last:ago(5)},10,now);
 assert.equal(m.used,3);assert.equal(m.remaining,7);assert.equal(m.pct,30);assert.equal(m.level,'ok');
 assert.equal(m.resetAt,ago(40)+HOUR_MS);
 assert.deepEqual(meterText(m,now),{right:'3/10',caption:'還剩 7 次 · 20 分鐘後重設'});
});

test('meter: 80% or more is high; all used is full and says so',()=>{
 assert.equal(meter({start:ago(10),count:48},60,now).level,'high');
 const full=meter({start:ago(40),count:10},10,now);
 assert.equal(full.level,'full');assert.equal(full.remaining,0);
 assert.deepEqual(meterText(full,now),{right:'10/10',caption:'這小時用完了 · 20 分鐘後重設'});
});

test('meter: never below one minute, never more used than the limit, a start in the future is no hour',()=>{
 assert.match(meterText(meter({start:ago(59.99),count:1},10,now),now).caption,/1 分鐘後重設/);
 assert.equal(meter({start:ago(5),count:12},10,now).used,10);
 assert.equal(meter({start:now+60000,count:3},10,now).used,0);
 assert.equal(meter({stamps:[now+60000,'x',NaN]},10,now).used,0);
});

test('usageWindow / recordUse: the first use opens the hour, later ones count in it, the next after it opens a new one',()=>{
 let u=recordUse({},ago(50));assert.deepEqual(u,{start:ago(50),count:1,last:ago(50)});
 u=recordUse(u,ago(20));assert.deepEqual(u,{start:ago(50),count:2,last:ago(20)});
 assert.deepEqual(usageWindow(u,now),{active:true,start:ago(50),count:2,resetAt:ago(50)+HOUR_MS,last:ago(20)});
 assert.deepEqual(recordUse(u,ago(-15)),{start:ago(-15),count:1,last:ago(-15)},'an hour after the first, a new hour');
 assert.deepEqual(usageWindow({stamps:[ago(30),ago(10)]},now),{active:true,start:ago(30),count:2,resetAt:ago(30)+HOUR_MS,last:ago(10)},'old {stamps} records');
});
