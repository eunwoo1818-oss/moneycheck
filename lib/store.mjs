import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openStore(path) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
      password TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user', disabled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS resets (token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS categories (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, type TEXT NOT NULL, name TEXT NOT NULL, PRIMARY KEY(user_id,type,name));
    CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL, amount REAL NOT NULL CHECK(amount>0), currency TEXT NOT NULL,
      original_day INTEGER NOT NULL, start_month TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount>0), date TEXT NOT NULL,
      category TEXT NOT NULL, memo TEXT NOT NULL DEFAULT '', subscription_id TEXT,
      billing_month TEXT, original_amount REAL, currency TEXT, rate REAL, rate_date TEXT,
      deleted INTEGER NOT NULL DEFAULT 0,
      UNIQUE(subscription_id,billing_month)
    );
    CREATE TABLE IF NOT EXISTS exchange_rates (date TEXT PRIMARY KEY, rate REAL NOT NULL, rate_date TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS users_single_admin ON users(role) WHERE role='admin';
    CREATE TABLE IF NOT EXISTS sms_devices (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, token TEXT UNIQUE NOT NULL, expires INTEGER NOT NULL);
  `);
  const columns = new Set(db.prepare('PRAGMA table_info(transactions)').all().map(c=>c.name));
  if (!columns.has('payment_method')) db.exec('ALTER TABLE transactions ADD COLUMN payment_method TEXT');
  if (!columns.has('card_company')) db.exec('ALTER TABLE transactions ADD COLUMN card_company TEXT');
  db.exec('CREATE TABLE IF NOT EXISTS card_companies (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, PRIMARY KEY(user_id,name))');
  db.exec('CREATE TABLE IF NOT EXISTS category_orders (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, value TEXT NOT NULL)');
  if(!db.prepare('PRAGMA table_info(users)').all().some(c=>c.name==='must_change_password'))db.exec('ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0');
  db.batch = statements => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const results = statements.map(({sql,args=[]}) => db.prepare(sql).run(...args));
      db.exec('COMMIT');
      return results;
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  db.consumeReset = (token, now, password) => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const row = db.prepare('SELECT user_id FROM resets WHERE token=? AND expires>?').get(token,now);
      if (!row) { db.exec('ROLLBACK'); return false; }
      db.prepare('UPDATE users SET password=?,must_change_password=0 WHERE id=?').run(password,row.user_id);
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(row.user_id);
      db.prepare('DELETE FROM resets WHERE user_id=?').run(row.user_id);
      db.exec('COMMIT'); return true;
    } catch(error) { db.exec('ROLLBACK'); throw error; }
  };
  return db;
}
export { defaults } from './categories.mjs';
