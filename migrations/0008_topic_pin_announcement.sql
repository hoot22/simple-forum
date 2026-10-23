-- 0008：主题置顶与「主题设为公告」
--
-- 说明：
-- - pinned = 1：主题在首页顶部「置顶」区块单独展示，不参与原有游标分页，
--   因此不会打乱「最新发布 / 最近回复」的分页顺序；
-- - is_announcement = 1：该主题同时出现在公告页；
-- - notifications 增加 topic_id：主题被设为公告时写入的公告行指向来源主题。
--   取消公告或删除主题时据此精确清理，避免按标题或链接模糊匹配。
-- - 迁移为追加式：本文件在任何环境应用过之后不可再修改，后续变更请新增文件。

ALTER TABLE topics ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;

ALTER TABLE topics ADD COLUMN is_announcement INTEGER NOT NULL DEFAULT 0;

ALTER TABLE notifications ADD COLUMN topic_id INTEGER REFERENCES topics (id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_topics_pinned ON topics (pinned, id DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_topic_id ON notifications (topic_id);
