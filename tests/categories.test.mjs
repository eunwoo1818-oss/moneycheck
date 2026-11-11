import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defaults,orderedCategories} from '../lib/categories.mjs';
test('기존 계정에도 세부 항목을 제공하고 사용자 순서·직접 만든 분류를 보존한다',()=>{
  const rows=orderedCategories([{type:'expense',name:'구독'},{type:'expense',name:'직접분류'},{type:'expense',name:'식비'}],{expense:['직접분류','식비','고정지출']});
  assert.deepEqual(rows.filter(c=>c.type==='expense').slice(0,3).map(c=>c.name),['직접분류','식비','고정지출']);
  assert.ok(rows.some(c=>c.type==='expense'&&c.name==='식비 · 카페·간식'));
  assert.ok(rows.some(c=>c.type==='income'&&c.name==='급여 · 상여금'));
  for(const kind of ['income','expense'])assert.equal(new Set(defaults[kind]).size,defaults[kind].length);
  assert.equal(rows.filter(c=>c.type==='expense'&&c.name==='식비').length,1);
});
