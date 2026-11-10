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
  child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:String(port),APP_URL:base,DATABASE_PATH:join(dir,'test.sqlite'),RESEND_API_KEY:'',MAIL_FROM:''},stdio:['ignore','pipe','pipe']});
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
