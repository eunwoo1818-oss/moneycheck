import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { makePostgresStore, postgresSql } from '../lib/postgres-store.mjs';

let engine, store, schema;
before(async()=>{
  engine = new PGlite();
  schema = await readFile(new URL('../migrations/001_postgres.sql',import.meta.url),'utf8');
  await engine.exec(schema);
  const query = (sql,args=[])=>engine.query(sql,args);
  store = makePostgresStore({query,connect:async()=>({query,release(){}}),end:()=>engine.close()});
});
after(async()=>store?.close());

test('고정 SQL을 변환하고 문자열 리터럴의 물음표는 보존한다',()=>{
  assert.equal(postgresSql("SELECT '?' AS literal WHERE id=? AND email=?"),"SELECT '?' AS literal WHERE id=$1 AND email=$2");
  assert.equal(postgresSql('INSERT OR IGNORE INTO categories VALUES (?,?,?)'),'INSERT INTO categories VALUES ($1,$2,$3) ON CONFLICT DO NOTHING');
});
test('PostgreSQL 실제 엔진에서 계정, 카테고리, 금액과 매개변수를 처리한다',async()=>{
  await store.prepare('INSERT INTO users(id,email,name,password,role) VALUES (?,?,?,?,?)').run('owner','owner@example.com','JE.KIM','hash','admin');
  await store.prepare('INSERT INTO users(id,email,name,password) VALUES (?,?,?,?)').run('person','person@example.com','사용자','hash');
  await store.prepare('INSERT OR IGNORE INTO categories VALUES (?,?,?)').run('person','expense','식비');
  const duplicate = await store.prepare('INSERT OR IGNORE INTO categories VALUES (?,?,?)').run('person','expense','식비');
  assert.equal(duplicate.changes,0);
  await store.prepare('INSERT INTO transactions(id,user_id,type,amount,date,category,memo) VALUES (?,?,?,?,?,?,?)').run('tx','person','expense',1000000000000,'2026-11-10','식비',"'; DROP TABLE users; --");
  const rows = await store.prepare('SELECT * FROM transactions WHERE user_id=?').all('person');
  assert.equal(Number(rows[0].amount),1000000000000);
  assert.equal(rows[0].memo,"'; DROP TABLE users; --");
  assert.equal((await store.prepare('SELECT * FROM transactions WHERE user_id=?').all('owner')).length,0);
  assert.equal((await store.prepare('SELECT * FROM users').all()).length,2);
});
test('일괄 저장 실패 시 전체를 롤백하고 관리자 중복을 거부한다',async()=>{
  await assert.rejects(store.batch([
    {sql:'INSERT INTO categories VALUES (?,?,?)',args:['person','expense','롤백 대상']},
    {sql:'INSERT INTO categories VALUES (?,?,?)',args:['missing-user','expense','오류']},
  ]));
  assert.equal(await store.prepare('SELECT name FROM categories WHERE name=?').get('롤백 대상'),undefined);
  await assert.rejects(store.prepare('INSERT INTO users(id,email,name,password,role) VALUES (?,?,?,?,?)').run('owner2','owner2@example.com','가짜 관리자','hash','admin'));
});
test('구독 청구 월은 중복 기록되지 않으며 배포 마이그레이션 재실행은 데이터를 유지한다',async()=>{
  const sql="INSERT OR IGNORE INTO transactions(id,user_id,type,amount,date,category,subscription_id,billing_month) VALUES (?,?,'expense',?,?,'구독',?,?)";
  await store.prepare(sql).run('bill1','person',9900,'2026-05-01','sub1','2026-04');
  const duplicate = await store.prepare(sql).run('bill2','person',9900,'2026-05-01','sub1','2026-04');
  assert.equal(duplicate.changes,0);
  await engine.exec(schema);
  assert.equal((await store.prepare('SELECT id FROM transactions WHERE subscription_id=?').all('sub1')).length,1);
});
test('영구 저장소의 로그인 제한 횟수를 원자적으로 증가시킨다',async()=>{
  const sql='INSERT INTO rate_limits(key,count,expires) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=rate_limits.count+1 RETURNING count';
  assert.equal((await store.prepare(sql).get('login',1794290000000)).count,1);
  assert.equal((await store.prepare(sql).get('login',1794290000000)).count,2);
});
test('재설정 토큰은 일회용이고 해당 사용자 세션만 폐기한다',async()=>{
  await store.prepare('INSERT INTO resets VALUES (?,?,?)').run('token','person',Date.now()+60000);
  await store.prepare('INSERT INTO sessions VALUES (?,?,?)').run('session1','person',Date.now()+60000);
  await store.prepare('INSERT INTO sessions VALUES (?,?,?)').run('session2','owner',Date.now()+60000);
  assert.equal(await store.consumeReset('token',Date.now(),'new-hash'),true);
  assert.equal(await store.consumeReset('token',Date.now(),'bad-hash'),false);
  assert.equal((await store.prepare('SELECT password FROM users WHERE id=?').get('person')).password,'new-hash');
  assert.equal((await store.prepare('SELECT * FROM sessions WHERE user_id=?').all('person')).length,0);
  assert.equal((await store.prepare('SELECT * FROM sessions WHERE user_id=?').all('owner')).length,1);
});
