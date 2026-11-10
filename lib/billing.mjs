export function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '2000-01-01' || value > '2100-12-31') return false;
  const parsed = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
export function nextMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return `${y + (m === 12 ? 1 : 0)}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}`;
}
export function billDate(month, day) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return day <= last ? `${month}-${String(day).padStart(2, '0')}` : `${nextMonth(month)}-01`;
}
export function occurrences(subscription, until, limit = 1200) {
  const result = [];
  let month = subscription.start_month;
  for (let i = 0; i < limit; i++) {
    const date = billDate(month, subscription.original_day);
    if (date > until) break;
    result.push({ month, date });
    month = nextMonth(month);
  }
  return result;
}
