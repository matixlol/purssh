PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_ip TEXT NOT NULL,
  last_seen_at INTEGER
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS feeds (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL UNIQUE,
  title TEXT,
  site_url TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  last_fetch_at INTEGER,
  last_success_at INTEGER,
  last_error_at INTEGER,
  last_error TEXT,
  fail_count INTEGER NOT NULL DEFAULT 0,
  paused_at INTEGER,
  failing_since INTEGER,
  failed24h_notified_at INTEGER
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  feed_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (feed_id) REFERENCES feeds(id) ON DELETE CASCADE,
  UNIQUE (user_id, feed_id)
);

CREATE TABLE IF NOT EXISTS entries (
  id TEXT PRIMARY KEY,
  feed_id TEXT NOT NULL,
  guid_or_url TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  published_at INTEGER,
  fetched_at INTEGER NOT NULL,
  FOREIGN KEY (feed_id) REFERENCES feeds(id) ON DELETE CASCADE,
  UNIQUE (feed_id, guid_or_url)
);

CREATE TABLE IF NOT EXISTS fetch_logs (
  id TEXT PRIMARY KEY,
  feed_id TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  ok INTEGER NOT NULL,
  http_status INTEGER,
  error TEXT,
  FOREIGN KEY (feed_id) REFERENCES feeds(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_feeds_status_last_fetch ON feeds(status, last_fetch_at);
CREATE INDEX IF NOT EXISTS idx_feeds_last_success ON feeds(last_success_at);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_entries_feed_fetched ON entries(feed_id, fetched_at);
CREATE INDEX IF NOT EXISTS idx_fetch_logs_feed_fetched ON fetch_logs(feed_id, fetched_at);

