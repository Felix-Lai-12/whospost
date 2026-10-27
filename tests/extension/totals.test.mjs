import test from 'node:test';
import assert from 'node:assert/strict';
import {addTotals,dashboardCells,emptyTotals} from '../../extension/lib/totals.mjs';

test('totals: start at zero, add up, remember when counting began',()=>{
 const a=addTotals(undefined,{reported:1},1000);
 assert.deepEqual(a,{queried:0,reported:1,since:1000});
 const b=addTotals(a,{queried:1,reported:2},2000);
 assert.deepEqual(b,{queried:1,reported:3,since:1000},'since stays at the first count');
 assert.deepEqual(addTotals(b,null,3000),b,'nothing to add changes nothing');
 assert.deepEqual(addTotals({queried:5,analyzed:120,since:9},{queried:1},10),{queried:6,reported:0,since:9},'an old 已分析 count is dropped (Felix 10-27)');
});

test('totals: junk and negatives never count',()=>{
 assert.deepEqual(addTotals('junk',{queried:-4,reported:'x'},5),{queried:0,reported:0,since:5});
 assert.deepEqual(addTotals({queried:2.9,reported:NaN,since:'x'},{queried:1},7),{queried:3,reported:0,since:7});
});

test('dashboard (Felix 10-27): 已查詢 · 已封鎖 · 已檢舉, an unreadable blocked list is null (shown as —), not 0',()=>{
 assert.deepEqual(dashboardCells({queried:4,reported:1},2).map(c=>[c.label,c.value]),[['你已查詢',4],['你已封鎖',2],['你已檢舉',1]]);
 assert.deepEqual(dashboardCells(emptyTotals(),null).map(c=>c.value),[0,null,0]);
});
