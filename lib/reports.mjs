// 연도가 바뀌어도 이전 장부의 월별 합계를 이어서 비교한다.
export function monthlyExpenses(transactions) {
  const totals = {};
  for (const t of transactions) {
    if (t.type !== 'expense' || t.deleted || !/^\d{4}-\d{2}-\d{2}$/.test(t.date) || !Number.isFinite(t.amount) || t.amount <= 0) continue;
    const month = t.date.slice(0,7);
    totals[month] = (totals[month] || 0) + t.amount;
  }
  return totals;
}
