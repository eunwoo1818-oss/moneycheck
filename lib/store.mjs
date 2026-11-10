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
  `);
  return db;
}
export const defaults = { expense: ['식비','교통','쇼핑','주거','의료','여가','기타'], income: ['급여','부수입','용돈','이자/배당','기타'] };
