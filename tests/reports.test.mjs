import {test} from 'node:test';
import assert from 'node:assert/strict';
import {monthlyExpenses,monthlyIncome} from '../lib/reports.mjs';
test('연도를 넘는 월별 실제 지출에 고정지출을 포함하고 수입·환불·삭제 내역은 제외한다',()=>{
  assert.deepEqual(monthlyExpenses([
    {date:'2025-12-31',type:'expense',amount:1000},
    {date:'2026-01-01',type:'expense',amount:30300},
    {date:'2026-01-02',type:'expense',amount:9900,subscription_id:'fixed'},
    {date:'2026-01-02',type:'income',amount:30300},
    {date:'2026-01-03',type:'expense',amount:10000,deleted:1},
    {date:'2026-02-01',type:'expense',amount:50},
  ]),{'2025-12':1000,'2026-01':40200,'2026-02':50});
  assert.deepEqual(monthlyExpenses([]),{});
});
test('월별 수입은 지출과 분리하고 삭제한 수입을 제외한다',()=>{
  const rows=[{date:'2025-12-01',type:'income',amount:2000},{date:'2026-01-01',type:'income',amount:3000},{date:'2026-01-02',type:'income',amount:100},{date:'2026-01-03',type:'income',amount:9000,deleted:1},{date:'2026-01-01',type:'expense',amount:500}];
  assert.deepEqual(monthlyIncome(rows),{'2025-12':2000,'2026-01':3100});
  assert.deepEqual(monthlyExpenses(rows),{'2026-01':500});
});
