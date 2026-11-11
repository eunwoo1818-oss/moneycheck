// 연도가 바뀌어도 이전 장부의 월별 합계를 이어서 비교한다.
function monthlyTotals(transactions, type) {
  const totals = {};
  for (const t of transactions) {
    if (t.type !== type || t.deleted || !/^\d{4}-\d{2}-\d{2}$/.test(t.date) || !Number.isFinite(t.amount) || t.amount <= 0) continue;
    const month = t.date.slice(0,7);
    totals[month] = (totals[month] || 0) + t.amount;
  }
  return totals;
}
export const monthlyExpenses = transactions => monthlyTotals(transactions,'expense');
export const monthlyIncome = transactions => monthlyTotals(transactions,'income');
