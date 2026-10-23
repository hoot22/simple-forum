-- Simple Forum 初始建表（Cloudflare D1 / SQLite）
-- 执行方式见 README「部署到 Cloudflare」小节。
-- 注意：迁移尚未在任何环境执行过，直接应用本文件即可。

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL,
  password_hash TEXT    NOT NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 用户名唯一（不区分大小写）
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower
  ON users (lower(username));

CREATE TABLE IF NOT EXISTS topics (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL,
  content    TEXT NOT NULL DEFAULT '',
  author_id  INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (author_id) REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_topics_created_at ON topics (created_at);
CREATE INDEX IF NOT EXISTS idx_topics_author_id  ON topics (author_id);

CREATE TABLE IF NOT EXISTS replies (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id   INTEGER NOT NULL,
  content    TEXT    NOT NULL,
  author_id  INTEGER,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (topic_id)  REFERENCES topics (id) ON DELETE CASCADE,
  FOREIGN KEY (author_id) REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_replies_topic_id  ON replies (topic_id);
CREATE INDEX IF NOT EXISTS idx_replies_author_id ON replies (author_id);
