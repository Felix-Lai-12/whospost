import test from 'node:test';
import assert from 'node:assert/strict';
import {addTotals,dashboardCells,emptyTotals} from '../../extension/lib/totals.mjs';

test('totals: start at zero, add up, remember when counting began',()=>{
 const a=addTotals(undefined,{analyzed:17},1000);
 assert.deepEqual(a,{queried:0,analyzed:17,since:1000});
 const b=addTotals(a,{queried:1,analyzed:3},2000);
 assert.deepEqual(b,{queried:1,analyzed:20,since:1000},'since stays at the first count');
 assert.deepEqual(addTotals(b,null,3000),b,'nothing to add changes nothing');
});

test('totals: junk and negatives never count',()=>{
 assert.deepEqual(addTotals('junk',{queried:-4,analyzed:'x'},5),{queried:0,analyzed:0,since:5});
 assert.deepEqual(addTotals({queried:2.9,analyzed:NaN,since:'x'},{queried:1},7),{queried:3,analyzed:0,since:7});
});

test('dashboard: 已查詢 · 已分析 · 已封鎖, an unreadable blocked list is null (shown as —), not 0',()=>{
 assert.deepEqual(dashboardCells({queried:4,analyzed:120},2).map(c=>[c.label,c.value]),[['你已查詢',4],['你已分析',120],['你已封鎖',2]]);
 assert.deepEqual(dashboardCells(emptyTotals(),null).map(c=>c.value),[0,0,null]);
});
