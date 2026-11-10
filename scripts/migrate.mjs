import { readFile } from 'node:fs/promises';
import pg from 'pg';

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!connectionString) throw new Error('DATABASE_URL 또는 POSTGRES_URL 설정이 필요합니다.');
const client = new pg.Client({ connectionString, connectionTimeoutMillis: 10000 });
try {
  await client.connect();
  await client.query('BEGIN');
  await client.query("SELECT pg_advisory_xact_lock(71549301)");
  await client.query(await readFile(new URL('../migrations/001_postgres.sql',import.meta.url),'utf8'));
  await client.query('COMMIT');
  console.log('PostgreSQL 테이블 준비 완료 (기존 데이터 유지)');
} catch (error) {
  await client.query('ROLLBACK').catch(()=>{});
  // 연결 문자열이나 원문 오류에 포함될 수 있는 인증 정보를 출력하지 않는다.
  console.error('데이터베이스 준비 실패. 연결 설정과 접근 권한을 확인해 주세요.', error.code || 'DB_ERROR');
  process.exitCode=1;
} finally { await client.end(); }
