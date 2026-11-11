// SQLite와 공유하는 고정 SQL의 플레이스홀더만 PostgreSQL 문법으로 변환한다.
// 사용자 입력은 항상 별도의 parameters로 전달한다.
export function postgresSql(input) {
  let sql = input;
  const ignore = /^INSERT OR IGNORE INTO /i.test(sql);
  if (ignore) sql = sql.replace(/^INSERT OR IGNORE INTO /i, 'INSERT INTO ');
  let index = 0;
  sql = sql.replace(/'(?:''|[^'])*'|\?/g, token => token === '?' ? `$${++index}` : token);
  if (ignore) sql += ' ON CONFLICT DO NOTHING';
  return sql;
}

export function makePostgresStore(pool) {
  const query = async (sql, args = [], client = pool) => {
    const result = await client.query(postgresSql(sql), args);
    return { rows: result.rows, changes: result.rowCount ?? result.affectedRows ?? 0 };
  };
  return {
    prepare(sql) {
      return {
        async get(...args) { return (await query(sql,args)).rows[0]; },
        async all(...args) { return (await query(sql,args)).rows; },
        async run(...args) { return query(sql,args); },
      };
    },
    async batch(statements) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const results = [];
        for (const {sql,args=[]} of statements) results.push(await query(sql,args,client));
        await client.query('COMMIT');
        return results;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally { client.release(); }
    },
    async consumeReset(token, now, password) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await client.query('SELECT user_id FROM resets WHERE token=$1 AND expires>$2 FOR UPDATE',[token,now]);
        const row = result.rows[0];
        if (!row) { await client.query('ROLLBACK'); return false; }
        await client.query('UPDATE users SET password=$1,must_change_password=0 WHERE id=$2',[password,row.user_id]);
        await client.query('DELETE FROM sessions WHERE user_id=$1',[row.user_id]);
        await client.query('DELETE FROM resets WHERE user_id=$1',[row.user_id]);
        await client.query('COMMIT'); return true;
      } catch(error) {
        await client.query('ROLLBACK'); throw error;
      } finally { client.release(); }
    },
    async close() { await pool.end(); },
  };
}

export async function openPostgresStore(connectionString) {
  const { default: pg } = await import('pg');
  // 앱 금액 및 밀리초 타임스탬프는 Number의 안전한 정수 범위 안이다.
  pg.types.setTypeParser(20, Number);
  const pool = new pg.Pool({ connectionString, max: 3, connectionTimeoutMillis: 8000, idleTimeoutMillis: 5000, allowExitOnIdle: true });
  pool.on('error', () => console.error('PostgreSQL 유휴 연결 오류'));
  return makePostgresStore(pool);
}
