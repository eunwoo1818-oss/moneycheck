import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { today } from '../lib/billing.mjs';

let child,dir,db,admin,person,adminId,personId,transactionId;
const port=33179, base=`http://127.0.0.1:${port}`;
async function request(path,method='GET',data, cookie) {
  const res=await fetch(base+'/api/'+path,{method,headers:{...(method==='GET'?{}:{'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{})},body:method==='GET'?undefined:JSON.stringify(data||{})});
  return {status:res.status,data:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]};
}
before(async()=>{
  dir=await mkdtemp(join(tmpdir(),'moneycheck-test-'));
  child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:String(port),APP_URL:base,DATABASE_PATH:join(dir,'test.sqlite'),RESEND_API_KEY:'',MAIL_FROM:'',CRON_SECRET:'test-cron-only',DATABASE_URL:'',POSTGRES_URL:'',VERCEL:''},stdio:['ignore','pipe','pipe']});
  await new Promise((resolve,reject)=>{let log='';const timeout=setTimeout(()=>reject(new Error('서버 시작 시간 초과 '+log)),10000); child.stdout.on('data',b=>{log+=b;if(log.includes('머니체크 실행')){clearTimeout(timeout);resolve();}}); child.once('error',reject);child.once('exit',code=>{clearTimeout(timeout);reject(new Error('서버 종료 '+code+' '+log));});});
  db=new DatabaseSync(join(dir,'test.sqlite'));
});
after(async()=>{db?.close();if(child&&child.exitCode===null){child.kill();await new Promise(r=>child.once('exit',r));}if(dir)await rm(dir,{recursive:true,force:true});});

test('최초 설정과 비밀번호 보호, 세션 단일화',async()=>{
  assert.equal((await request('data')).status,401);
  assert.equal((await request('status')).data.setup,true);
  let r=await request('register','POST',{email:'admin@example.com',password:'correct-password',name:'wrong'});assert.equal(r.status,200);admin=r.cookie;
  let data=(await request('data','GET',null,admin)).data;
  assert.equal(data.user.name,'JE.KIM');assert.equal(data.user.role,'admin');adminId=data.user.id;
  r=await request('login','POST',{email:'admin@example.com',password:'wrong-password'});assert.equal(r.status,401);
  r=await request('login','POST',{email:'admin@example.com',password:'correct-password'});assert.equal(r.status,200);
  assert.equal((await request('data','GET',null,admin)).status,401);admin=r.cookie;
  assert.equal((await request('status')).data.setup,false);
});
test('계정 격리, 카테고리와 내역 CRUD, 유효성 검사',async()=>{
  let r=await request('register','POST',{email:'person@example.com',password:'correct-password',name:'사용자',role:'admin'});person=r.cookie;
  const data=(await request('data','GET',null,person)).data;personId=data.user.id;assert.equal(data.user.role,'user');
  assert.equal((await request('categories','POST',{type:'expense',name:'교육'},person)).status,200);
  r=await request('transactions','POST',{type:'expense',amount:23000,date:today(),category:'교육',memo:'강의',user_id:adminId},person);assert.equal(r.status,200);
  const rows=(await request('data','GET',null,person)).data.transactions;transactionId=rows[0].id;
  assert.equal(rows[0].user_id,personId);assert.equal((await request('data','GET',null,admin)).data.transactions.length,0);
  assert.equal((await request(`transactions/${transactionId}`,'PATCH',{type:'expense',amount:1,date:today(),category:'기타'},admin)).status,404);
  assert.equal((await request(`transactions/${transactionId}`,'DELETE',{},admin)).status,404);
  assert.equal((await request('admin/users','GET',null,person)).status,403);
  for(const change of [{amount:-1},{amount:0.5},{date:'2026-13-01'},{date:'2026-02-30'},{category:'없는 분류'}]) {
    assert.equal((await request('transactions','POST',{type:'expense',amount:100,date:today(),category:'식비',...change},person)).status,400);
  }
  assert.equal((await request(`transactions/${transactionId}`,'PATCH',{type:'expense',amount:25000,date:today(),category:'교육',memo:'수정'},person)).status,200);
  assert.equal((await request('data','GET',null,person)).data.transactions[0].amount,25000);
  assert.equal((await request(`transactions/${transactionId}`,'DELETE',{},person)).status,200);
  assert.equal((await request('data','GET',null,person)).data.transactions.length,0);
});
test('구독 청구분 중복 방지, 이월, 삭제 후 재생성 방지, 수정 및 해지',async()=>{
  assert.equal((await request('subscriptions','POST',{name:'월말 구독',amount:9900,currency:'KRW',next_date:'2026-05-01',original_day:31},person)).status,200);
  let data=(await request('data','GET',null,person)).data;
  const sub=data.subscriptions[0];
  assert.equal(data.transactions.find(t=>t.billing_month==='2026-04').date,'2026-05-01');
  assert.equal(data.transactions.find(t=>t.billing_month==='2026-05').date,'2026-05-31');
  const count=data.transactions.length;
  await Promise.all([request('data','GET',null,person),request('data','GET',null,person)]);
  data=(await request('data','GET',null,person)).data;assert.equal(data.transactions.length,count);
  const tx=data.transactions[0];
  await request('transactions/'+tx.id,'DELETE',{},person);
  data=(await request('data','GET',null,person)).data;assert.equal(data.transactions.length,count-1);
  assert.equal((await request('subscriptions/'+sub.id,'PATCH',{name:'새 이름',amount:15000,currency:'KRW'},person)).status,200);
  data=(await request('data','GET',null,person)).data;
  assert.equal(data.subscriptions[0].amount,15000);assert.equal(data.transactions[0].amount,9900);
  assert.equal((await request('subscriptions/'+sub.id,'DELETE',{},admin)).status,404);
  await request('subscriptions/'+sub.id,'DELETE',{},person);
  data=(await request('data','GET',null,person)).data;assert.equal(data.subscriptions.length,0);assert.equal(data.transactions.length,count-1);
});
test('달러 구독은 결제일별 캐시 환율과 출처 날짜를 보존한다',async()=>{
  db.prepare('INSERT OR REPLACE INTO exchange_rates VALUES (?,?,?)').run(today(),1400.5,today());
  const r=await request('subscriptions','POST',{name:'달러 구독',amount:9.99,currency:'USD',next_date:today()},person);assert.equal(r.status,200);
  const data=(await request('data','GET',null,person)).data, tx=data.transactions.find(t=>t.memo==='달러 구독');
  assert.equal(tx.amount,Math.round(9.99*1400.5));assert.equal(tx.rate,1400.5);assert.equal(tx.original_amount,9.99);assert.equal(tx.rate_date,today());
});
test('관리자는 계정 정보만 조회하고 이용을 정지/재개한다',async()=>{
  const r=await request('admin/users','GET',null,admin);assert.equal(r.status,200);
  assert.equal(r.data.users.length,2);
  for(const u of r.data.users){assert.equal(u.password,undefined);assert.equal(u.transactions,undefined);}
  assert.equal((await request('admin/users/'+adminId,'PATCH',{disabled:true},admin)).status,400);
  assert.equal((await request('admin/users/'+personId,'PATCH',{disabled:true},admin)).status,200);
  assert.equal((await request('data','GET',null,person)).status,401);
  assert.equal((await request('login','POST',{email:'person@example.com',password:'correct-password'})).status,401);
  await request('admin/users/'+personId,'PATCH',{disabled:false},admin);
  const login=await request('login','POST',{email:'person@example.com',password:'correct-password'});assert.equal(login.status,200);person=login.cookie;
});
test('이메일 미설정을 알리고 재설정 토큰은 일회용이며 기존 세션을 폐기한다',async()=>{
  assert.equal((await request('forgot','POST',{email:'person@example.com'})).status,503);
  const token='a'.repeat(64), hashed=createHash('sha256').update(token).digest('hex');
  db.prepare('INSERT INTO resets VALUES (?,?,?)').run(hashed,personId,Date.now()+60000);
  assert.equal((await request('reset','POST',{token,password:'a-new-password'})).status,200);
  assert.equal((await request('data','GET',null,person)).status,401);
  assert.equal((await request('reset','POST',{token,password:'another-password'})).status,400);
  assert.equal((await request('login','POST',{email:'person@example.com',password:'a-new-password'})).status,200);
});
test('교차 사이트 요청과 비공개 파일 접근을 거부한다',async()=>{
  const r=await fetch(base+'/api/logout',{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json',Cookie:admin},body:'{}'});assert.equal(r.status,403);
  assert.equal((await fetch(base+'/data/moneycheck.sqlite')).status,404);
  assert.equal((await fetch(base+'/server.mjs')).status,404);
  assert.equal((await fetch(base+'/')).status,200);
});
test('예약 기록은 유효한 서버 비밀 값으로만 호출할 수 있다',async()=>{
  assert.equal((await request('cron')).status,401);
  const r=await fetch(base+'/api/cron',{headers:{Authorization:'Bearer test-cron-only'}});
  assert.equal(r.status,200);assert.equal((await r.json()).processed,2);
});
test('이전 연도는 올해 장부에서 제외되고 본인만 CSV로 저장할 수 있다',async()=>{
  const year=Number(today().slice(0,4))-1;
  db.prepare("INSERT INTO transactions(id,user_id,type,amount,date,category,memo) VALUES ('archive-test',?,'expense',1000,?,'식비',?)")
    .run(adminId,`${year}-12-31`,'=1+2');
  const current=await request('data','GET',null,admin);
  assert.equal(current.data.year,today().slice(0,4));
  assert.ok(!current.data.transactions.some(t=>t.id==='archive-test'));
  assert.equal(current.data.monthlyExpenses[`${year}-12`],1000);
  assert.equal((await request('transactions/archive-test','DELETE',{},admin)).status,404);
  const url=base+`/api/export?year=${year}`;
  assert.equal((await fetch(url)).status,401);
  const own=await fetch(url,{headers:{Cookie:admin}});
  assert.equal(own.status,200);
  assert.match(own.headers.get('content-disposition'),/\.csv/);
  assert.match(await own.text(),/"'=1\+2"/);
  const other=await request('login','POST',{email:'person@example.com',password:'a-new-password'});
  assert.equal(other.status,200);
  assert.equal((await request('data','GET',null,other.cookie)).data.monthlyExpenses[`${year}-12`],undefined);
  assert.doesNotMatch(await (await fetch(url,{headers:{Cookie:other.cookie}})).text(),/=1\+2/);
});

test('카드 문자 연결은 소유자만 발급·해제하고 중복·삭제 문자와 다른 계정을 격리한다',async()=>{
  assert.equal((await request('sms/device','POST')).status,401);
  const {data:{token}}=await request('sms/device','POST',{},admin);
  assert.match(token,/^[a-f0-9]{64}$/);
  assert.notEqual(db.prepare('SELECT token FROM sms_devices WHERE user_id=?').get(adminId).token,token);
  const receivedAt=Date.now(),day=today().replaceAll('-','.');
  const payload={sender:'15447000',message:`신한카드 ${day} 30300 GS편의점`,receivedAt,user_id:personId};
  const ingest=async (key=token,data=payload)=>{
    const res=await fetch(base+'/api/sms/receive',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},body:JSON.stringify(data)});
    return {status:res.status,data:await res.json()};
  };
  assert.equal((await ingest()).data.recorded,true);
  const retry=await Promise.all([ingest(),ingest()]);assert.ok(retry.every(r=>r.data.recorded===false));
  const row=db.prepare("SELECT * FROM transactions WHERE id LIKE 'sms-%'").get();assert.equal(row.user_id,adminId);assert.equal(row.amount,30300);assert.doesNotMatch(row.memo,/15447000/);
  await request('transactions/'+row.id,'DELETE',{},admin);assert.equal((await ingest()).data.recorded,false);
  assert.equal((await ingest(token,{...payload,message:'인증 번호 123456'})).data.recorded,false);
  assert.equal((await ingest('f'.repeat(64))).status,401);
  const rotated=await request('sms/device','POST',{},admin);assert.equal((await ingest()).status,401);
  assert.equal((await ingest(rotated.data.token)).status,200);
  await request('sms/device','DELETE',{},admin);assert.equal((await ingest(rotated.data.token)).status,401);
  assert.equal((await request('sms/device','GET',null,admin)).data.connected,false);
});

test('이전 구독 분류도 고정지출로 표시하고 수정·CSV 저장한다',async()=>{
  db.prepare("DELETE FROM categories WHERE user_id=? AND name='고정지출'").run(adminId);
  db.prepare("INSERT OR IGNORE INTO categories VALUES (?,'expense','구독')").run(adminId);
  db.prepare("INSERT INTO transactions(id,user_id,type,amount,date,category) VALUES ('legacy-fixed',?,'expense',9900,?,'구독')").run(adminId,today());
  const data=(await request('data','GET',null,admin)).data;
  assert.equal(data.transactions.find(t=>t.id==='legacy-fixed').category,'고정지출');
  assert.ok(!data.categories.some(c=>c.name==='구독'));
  assert.equal((await request('transactions/legacy-fixed','PATCH',{type:'expense',amount:10000,date:today(),category:'고정지출'},admin)).status,200);
  const file=await fetch(base+'/api/export',{headers:{Cookie:admin}});assert.match(await file.text(),/고정지출/);
});

test('현금·카드와 사용자별 카드사를 저장하고 결제수단 변경·CSV·기존 내역을 처리한다',async()=>{
  assert.equal((await request('card-companies','POST',{name:'신한카드'})).status,401);
  for(const name of ['', ' '.repeat(3),'가'.repeat(41)])assert.equal((await request('card-companies','POST',{name},admin)).status,400);
  for(let i=0;i<2;i++)assert.equal((await request('card-companies','POST',{name:' 신한카드 '},admin)).status,200);
  let data=(await request('data','GET',null,admin)).data;
  assert.deepEqual(data.cardCompanies,[{name:'신한카드'}]);
  const login=await request('login','POST',{email:'person@example.com',password:'a-new-password'});
  assert.deepEqual((await request('data','GET',null,login.cookie)).data.cardCompanies,[]);
  const draft={type:'expense',amount:30300,date:today(),category:'기타',memo:'카드 테스트',payment_method:'card',card_company:'신한카드'};
  assert.equal((await request('transactions','POST',draft,login.cookie)).status,400);
  for(const extra of [{payment_method:'unknown'},{card_company:''},{card_company:'없는 카드사'}])assert.equal((await request('transactions','POST',{...draft,...extra},admin)).status,400);
  assert.equal((await request('transactions','POST',draft,admin)).status,200);
  data=(await request('data','GET',null,admin)).data;
  const row=data.transactions.find(t=>t.memo===draft.memo);assert.equal(row.payment_method,'card');assert.equal(row.card_company,'신한카드');
  const csv=await fetch(base+'/api/export',{headers:{Cookie:admin}});assert.match(await csv.text(),/"카드","신한카드"/);
  const {payment_method,card_company,...oldClient}=draft;
  await request('transactions/'+row.id,'PATCH',{...oldClient,amount:31000},admin);
  assert.equal((await request('data','GET',null,admin)).data.transactions.find(t=>t.id===row.id).card_company,'신한카드');
  await request('transactions/'+row.id,'PATCH',{...draft,payment_method:'cash'},admin);
  let saved=(await request('data','GET',null,admin)).data.transactions.find(t=>t.id===row.id);assert.equal(saved.payment_method,'cash');assert.equal(saved.card_company,null);
  await request('transactions/'+row.id,'PATCH',{...draft,type:'income'},admin);
  saved=(await request('data','GET',null,admin)).data.transactions.find(t=>t.id===row.id);assert.equal(saved.payment_method,null);assert.equal(saved.card_company,null);
  const legacy=(await request('data','GET',null,admin)).data.transactions.find(t=>t.id==='legacy-fixed');assert.equal(legacy.payment_method,null);
});

test('아이폰 문자 본문 자동 등록은 재시도·토큰 해제·읽기 권한을 검증한다',async()=>{
  const key=await request('sms/device','POST',{},admin), token=key.data.token;
  const send=async message=>{const r=await fetch(base+'/api/sms/iphone',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({message})});return {status:r.status,data:await r.json()};};
  const message=`신한카드 ${today().replaceAll('-','.')} 12345 아이폰테스트`;
  assert.equal((await send(message)).data.recorded,true);
  assert.equal((await send(message)).data.recorded,false);
  assert.equal((await send(' '+message+'\r\n')).data.recorded,false);
  assert.equal((await send('인증번호 123456')).data.recorded,false);
  const data=(await request('data','GET',null,admin)).data;
  assert.equal(data.transactions.filter(t=>t.memo==='카드 문자 결제 · 아이폰테스트').length,1);
  assert.equal(data.monthlyIncome[today().slice(0,7)],30300);
  assert.equal((await fetch(base+'/api/data',{headers:{Authorization:'Bearer '+token}})).status,401);
  await request('sms/device','DELETE',{},admin);assert.equal((await send(message)).status,401);
});

test('카테고리 순서를 계정별로 저장하고 잘못된 목록을 거부한다',async()=>{
  assert.equal((await request('categories/order','PUT',{})).status,401);
  const original=(await request('data','GET',null,admin)).data.categories;
  const order=Object.fromEntries(['expense','income'].map(kind=>[kind,original.filter(c=>c.type===kind).map(c=>c.name).reverse()]));
  assert.equal((await request('categories/order','PUT',order,admin)).status,200);
  const saved=(await request('data','GET',null,admin)).data.categories;
  for(const kind of ['expense','income'])assert.deepEqual(saved.filter(c=>c.type===kind).map(c=>c.name),order[kind]);
  assert.equal((await request('categories/order','PUT',{...order,expense:['없음']},admin)).status,400);
  assert.equal((await request('categories/order','PUT',{...order,income:order.income.map(()=>order.income[0])},admin)).status,400);
  const login=await request('login','POST',{email:'person@example.com',password:'a-new-password'});
  assert.equal(db.prepare('SELECT value FROM category_orders WHERE user_id=?').get(personId),undefined);
  assert.equal((await request('data','GET',null,login.cookie)).status,200);
  await request('categories','POST',{type:'expense',name:'추가분류'},admin);
  assert.equal((await request('data','GET',null,admin)).data.categories.filter(c=>c.type==='expense').at(-1).name,'추가분류');
});

test('달력 조회는 이전 연도·월 경계와 계정 격리를 지키고 수정은 계속 거부한다',async()=>{
  const month=(Number(today().slice(0,4))-1)+'-12';
  assert.equal((await request('calendar?month='+month)).status,401);
  const own=await request('calendar?month='+month,'GET',null,admin);
  assert.equal(own.status,200);assert.equal(own.data.transactions.length,1);assert.equal(own.data.transactions[0].id,'archive-test');
  for(const bad of ['2026-13','1999-01','2111-01','invalid'])assert.equal((await request('calendar?month='+bad,'GET',null,admin)).status,400);
  const login=await request('login','POST',{email:'person@example.com',password:'a-new-password'});
  assert.equal((await request('calendar?month='+month,'GET',null,login.cookie)).data.transactions.length,0);
  assert.equal((await request('transactions/archive-test','PATCH',{amount:1},admin)).status,404);
});

test('관리자 임시 비밀번호 초기화는 기존 세션·복구 링크·문자 키를 폐기하고 비밀번호 변경을 강제한다',async()=>{
  const login=await request('login','POST',{email:'person@example.com',password:'a-new-password'}), old=login.cookie;
  const device=(await request('sms/device','POST',{},old)).data.token;
  const reset='d'.repeat(64);db.prepare('INSERT INTO resets VALUES (?,?,?)').run(createHash('sha256').update(reset).digest('hex'),personId,Date.now()+60000);
  const path='admin/users/'+personId+'/reset-password';
  assert.equal((await request(path,'POST',{},old)).status,403);
  assert.equal((await request('admin/users/'+adminId+'/reset-password','POST',{},admin)).status,404);
  assert.equal((await request(path,'POST',{},admin)).status,200);
  assert.equal((await request('data','GET',null,old)).status,401);
  assert.notEqual(db.prepare('SELECT password FROM users WHERE id=?').get(personId).password,'1234asdf!@#');
  assert.equal((await request('login','POST',{email:'person@example.com',password:'a-new-password'})).status,401);
  const temp=await request('login','POST',{email:'person@example.com',password:'1234asdf!@#'});assert.equal(temp.status,200);
  assert.deepEqual((await request('data','GET',null,temp.cookie)).data,{passwordChangeRequired:true});
  assert.equal((await request('export','GET',null,temp.cookie)).status,403);
  assert.equal((await request('categories/order','PUT',{},temp.cookie)).status,403);
  const sms=await fetch(base+'/api/sms/iphone',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+device},body:'{}'});assert.equal(sms.status,401);
  assert.equal((await request('reset','POST',{token:reset,password:'not-allowed-password'})).status,400);
  assert.equal((await request('account/password','POST',{current_password:'wrong',password:'new-correct-password'},temp.cookie)).status,403);
  assert.equal((await request('account/password','POST',{current_password:'1234asdf!@#',password:'1234asdf!@#'},temp.cookie)).status,400);
  const changed=await request('account/password','POST',{current_password:'1234asdf!@#',password:'new-correct-password'},temp.cookie);assert.equal(changed.status,200);
  assert.equal((await request('data','GET',null,temp.cookie)).status,401);
  assert.equal((await request('data','GET',null,changed.cookie)).status,200);
  assert.equal((await request('login','POST',{email:'person@example.com',password:'1234asdf!@#'})).status,401);
  assert.equal((await request('login','POST',{email:'person@example.com',password:'new-correct-password'})).status,200);
});
