import test from 'node:test';
import assert from 'node:assert/strict';
import {addTotals,dashboardCells,emptyTotals} from '../../extension/lib/totals.mjs';

test('totals: start at zero, add up, remember when counting began',()=>{
 const a=addTotals(undefined,{background:1},1000);
 assert.deepEqual(a,{queried:0,background:1,since:1000});
 const b=addTotals(a,{queried:1,background:2},2000);
 assert.deepEqual(b,{queried:1,background:3,since:1000},'since stays at the first count');
 assert.deepEqual(addTotals(b,null,3000),b,'nothing to add changes nothing');
 assert.deepEqual(addTotals({queried:5,analyzed:120,reported:2,since:9},{queried:1},10),{queried:6,background:0,since:9},'old 已分析／已檢舉 counts are dropped (Felix 10-27)');
});

test('totals: junk and negatives never count',()=>{
 assert.deepEqual(addTotals('junk',{queried:-4,background:'x'},5),{queried:0,background:0,since:5});
 assert.deepEqual(addTotals({queried:2.9,background:NaN,since:'x'},{queried:1},7),{queried:3,background:0,since:7});
});

test('dashboard (Felix 10-27): AI 打詐 · 查詢背景 · 封鎖, counts of times; an unreadable blocked list is null (shown as —), not 0',()=>{
 assert.deepEqual(dashboardCells({queried:4,background:1},2).map(c=>[c.label,c.value]),[['AI 打詐',4],['查詢背景',1],['封鎖',2]]);
 assert.deepEqual(dashboardCells(emptyTotals(),null).map(c=>c.value),[0,0,null]);
});
