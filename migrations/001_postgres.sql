CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  password TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user',
  disabled SMALLINT NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP::TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS users_single_admin ON users(role) WHERE role='admin';
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS resets (
  token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS categories (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL, name TEXT NOT NULL, PRIMARY KEY(user_id,type,name)
);
CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, amount DOUBLE PRECISION NOT NULL CHECK(amount>0), currency TEXT NOT NULL,
  original_day INTEGER NOT NULL CHECK(original_day BETWEEN 1 AND 31),
  start_month TEXT NOT NULL, active SMALLINT NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL, amount BIGINT NOT NULL CHECK(amount>0 AND amount<=1000000000000000),
  date TEXT NOT NULL, category TEXT NOT NULL, memo TEXT NOT NULL DEFAULT '',
  subscription_id TEXT, billing_month TEXT, original_amount DOUBLE PRECISION,
  currency TEXT, rate DOUBLE PRECISION, rate_date TEXT,
  deleted SMALLINT NOT NULL DEFAULT 0, UNIQUE(subscription_id,billing_month)
);
CREATE TABLE IF NOT EXISTS exchange_rates (
  date TEXT PRIMARY KEY, rate DOUBLE PRECISION NOT NULL, rate_date TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS transactions_user_date ON transactions(user_id,date);
CREATE INDEX IF NOT EXISTS subscriptions_user_active ON subscriptions(user_id,active);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
