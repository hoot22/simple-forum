-- 0006：通知与公告
--
-- 说明：
-- - kind = 'notification' 为定向通知，user_id 指向接收者；当前由「有人回复了你的主题」产生；
-- - kind = 'announcement' 为站内公告，user_id 为 NULL，所有登录用户可见；
-- - 已读状态不写入 notifications 本身，而是按「用户 + 通知」逐条记录在 notification_reads，
--   这样同一条公告的已读状态不会在用户之间互相影响，定向通知也无需改行即可标记已读；
-- - 未读判定统一为：通知可见 且 在 notification_reads 中没有对应记录；
-- - 迁移为追加式：本文件在任何环境应用过之后不可再修改，后续变更请新增文件。

CREATE TABLE notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  link TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (kind IN ('notification', 'announcement')),
  CHECK (kind <> 'announcement' OR user_id IS NULL),
  CHECK (kind <> 'notification' OR user_id IS NOT NULL),
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX idx_notifications_kind_user_created
  ON notifications (kind, user_id, created_at DESC, id DESC);

CREATE INDEX idx_notifications_kind_created
  ON notifications (kind, created_at DESC, id DESC);

CREATE TABLE notification_reads (
  user_id INTEGER NOT NULL,
  notification_id INTEGER NOT NULL,
  read_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, notification_id),
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  FOREIGN KEY (notification_id) REFERENCES notifications (id) ON DELETE CASCADE
);
