import { createHash } from 'node:crypto';
import { validDate } from './billing.mjs';

// 인식이 불명확하면 기록하지 않는다. 원문·전화번호·카드번호는 장부에 저장하지 않는다.
export function parseCardSms({sender, message, receivedAt}, now = Date.now()) {
  if (typeof sender !== 'string' || sender.length > 40 || typeof message !== 'string' || message.length > 2000 || !Number.isSafeInteger(receivedAt)) return null;
  if (receivedAt > now + 300000 || receivedAt < now - 7*86400000) return null;
  const s = message.normalize('NFKC');
  const simple = /^(신한카드|현대카드|삼성카드|롯데카드|국민카드|KB국민카드|하나카드|우리카드|농협카드|NH농협카드|BC카드)\s+(20\d{2})[.\/-](\d{2})[.\/-](\d{2})\s+([1-9]\d{0,11}|[1-9]\d{0,2}(?:,\d{3})+)\s*(?:원\s+|\s+)([^\n]{1,80})$/.exec(s.trim());
  if (simple) {
    const date = `${simple[2]}-${simple[3]}-${simple[4]}`;
    const received = new Date(receivedAt+9*3600000).toISOString().slice(0,10);
    const amount = Number(simple[5].replaceAll(',',''));
    if (!validDate(date) || date.slice(0,4)!==new Date(now+9*3600000).toISOString().slice(0,4) || Math.abs(Date.parse(date)-Date.parse(received))>2*86400000 || amount>1e12 || /취소|거절|예정|인증|\d{8,}|[*]|님/.test(simple[6])) return null;
    return {type:'expense',amount,date,category:'기타',memo:`카드 문자 결제 · ${simple[6].trim()}`,event:createHash('sha256').update(JSON.stringify([sender.replace(/[^\d+]/g,''),receivedAt,s])).digest('hex')};
  }
  if (!/(카드|신한|현대|삼성|롯데|국민|농협|하나|우리|비씨|KB|NH|BC)/i.test(s) || !/(승인|취소)/.test(s)) return null;
  if (/(거절|실패|예정|안내|인증|누적취소|USD|US\$|달러|해외|부분취소)/i.test(s)) return null;
  const amounts = [...s.matchAll(/(?<![\d,.])([1-9]\d{0,2}(?:,\d{3})+|[1-9]\d*)\s*원/g)]
    .filter(m => !/(누적|잔액|한도|합계|총액)\s*[:：]?\s*$/.test(s.slice(Math.max(0,m.index-15),m.index)));
  if (amounts.length !== 1) return null;
  const amount = Number(amounts[0][1].replaceAll(',',''));
  if (!Number.isSafeInteger(amount) || amount > 1e12) return null;
  const received = new Date(receivedAt + 9*3600000).toISOString().slice(0,10);
  const stamp = /(?:^|[^\d])(\d{2})[/.](\d{2})\s+(\d{2}):(\d{2})(?!\d)/.exec(s);
  if (!stamp || +stamp[3] > 23 || +stamp[4] > 59) return null;
  const candidates = [-1,0,1].map(offset => `${Number(received.slice(0,4))+offset}-${stamp[1]}-${stamp[2]}`).filter(validDate);
  const date = candidates.sort((a,b)=>Math.abs(Date.parse(a)-Date.parse(received))-Math.abs(Date.parse(b)-Date.parse(received)))[0];
  if (!date || Math.abs(Date.parse(date)-Date.parse(received)) > 2*86400000 || date.slice(0,4) !== new Date(now+9*3600000).toISOString().slice(0,4)) return null;
  const tail = s.slice(stamp.index+stamp[0].length).replace(/^\s*(?:일시불|\d+개월)\s*/, '').trimStart();
  const merchant = tail.split(/\n|누적|잔액|한도/)[0].replace(/^[\s:：]+/, '').trim();
  // 금액이 날짜 뒤에 오는 카드사는 다음 줄의 사용처만 취한다.
  const lines = tail.split('\n').map(v=>v.trim()).filter(Boolean);
  const name = /원/.test(merchant) ? lines.find(v=>!/(원|일시불|할부|누적|잔액|한도|카드|승인|취소)/.test(v)) : merchant;
  if (!name || name.length > 80 || /\d{8,}|[*]|님/.test(name)) return null;
  return {type:/취소/.test(s)?'income':'expense', amount, date, category:'기타', memo:`카드 문자 ${/취소/.test(s)?'환불':'결제'} · ${name}`,
    event: createHash('sha256').update(JSON.stringify([sender.replace(/[^\d+]/g,''),receivedAt,s])).digest('hex')};
}
