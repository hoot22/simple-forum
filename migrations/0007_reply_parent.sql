-- 0007：回复支持嵌套（评论某条评论）
--
-- 说明：
-- - parent_reply_id 指向被回复的回复；NULL 表示顶层回复；
-- - 自引用外键 + ON DELETE CASCADE：删除某条回复时，其下的回复一并删除；
--   删除主题时本表按 topic_id 整体清理，两者不冲突；
-- - SQLite 的 ALTER TABLE ADD COLUMN 允许带 REFERENCES，只要默认值为 NULL。

ALTER TABLE replies ADD COLUMN parent_reply_id INTEGER REFERENCES replies (id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_replies_parent_reply_id ON replies (parent_reply_id);
