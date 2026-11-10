import test from 'node:test';
import assert from 'node:assert/strict';
import { billDate, nextMonth, occurrences, validDate } from '../lib/billing.mjs';

test('31일 결제는 없는 날짜를 다음 달 1일로 이월하고 원래 날짜를 유지한다',()=>{
  assert.equal(billDate('2026-04',31),'2026-05-01');
  assert.equal(billDate('2026-05',31),'2026-05-31');
  assert.deepEqual(occurrences({start_month:'2026-04',original_day:31},'2026-05-31'),[
    {month:'2026-04',date:'2026-05-01'}, {month:'2026-05',date:'2026-05-31'}
  ]);
});
test('윤년 및 연도 전환을 처리한다',()=>{
  assert.equal(billDate('2028-02',29),'2028-02-29');
  assert.equal(billDate('2027-02',29),'2027-03-01');
  assert.equal(billDate('2026-02',30),'2026-03-01');
  assert.equal(nextMonth('2026-12'),'2027-01');
});
test('잘못된 날짜와 범위를 거부한다',()=>{
  for(const v of ['2026-02-30','2026-13-01','2026-00-10','bad','1999-01-01',null]) assert.equal(validDate(v),false);
  assert.equal(validDate('2028-02-29'),true);
});
