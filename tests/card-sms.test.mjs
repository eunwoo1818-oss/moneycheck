import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseCardSms,parseIphoneSms} from '../lib/card-sms.mjs';
const now=Date.parse('2026-11-11T04:00:00Z');
const parse=message=>parseCardSms({sender:'1544-7000',message,receivedAt:now},now);
test('아이폰 단축어는 본문만으로 인식하고 실행 시각이 다른 재시도도 같은 식별자를 만든다',()=>{
  const message='신한카드 2026.11.11 30300 GS편의점';
  const a=parseIphoneSms({message},now),b=parseIphoneSms({message:' '+message+'\r\n'},now+60000);
  assert.equal(a.amount,30300);assert.equal(a.event,b.event);
  assert.equal(parseIphoneSms({message:'인증번호 123456'},now),null);
  assert.equal(parseIphoneSms({},now),null);
});
test('사용자가 제공한 신한카드 형식과 실제 승인 문자에서 금액·사용처를 추출한다',()=>{
  const simple=parse('신한카드 2026.11.11 30300 GS편의점');assert.equal(simple.amount,30300);assert.equal(simple.date,'2026-11-11');assert.equal(simple.memo,'카드 문자 결제 · GS편의점');
  const text='[Web발신]\n신한카드 승인\n홍*동님(1234)\n30,300원 일시불\n11/11 12:34\nGS편의점\n누적 130,300원';
  const result=parse(text);assert.equal(result.amount,30300);assert.equal(result.memo,'카드 문자 결제 · GS편의점');assert.equal(result.type,'expense');assert.deepEqual(parse(text),result);
  assert.equal(parse(text.replace('승인','취소')).type,'income');
});
test('인증·거절·외화·부분 취소·모호한 금액·잘못된 날짜를 기록하지 않는다',()=>{
  for(const s of ['신한카드 인증 30,300원 11/11 12:34 GS편의점','신한카드 거절 30,300원 승인 11/11 12:34 GS편의점','신한카드 승인 해외 USD 30,300원 11/11 12:34 GS편의점','신한카드 부분취소 30,300원 11/11 12:34 GS편의점','신한카드 승인 30,300원 40,000원 11/11 12:34 GS편의점','신한카드 2026.02.30 30300 GS편의점','신한카드 2025.11.11 30300 GS편의점'])assert.equal(parse(s),null,s);
});
