-- 0002：为游标分页与个人页查询补充复合索引（P1）
-- 说明：
-- - 0001 的单列索引保留；这里新增与「排序键 + id」匹配的复合索引，
--   服务 keyset 分页的 WHERE / ORDER BY（created_at DESC, id DESC 的顺序扫描）。
-- - 索引是否命中请在上线前用真实规模数据执行 EXPLAIN QUERY PLAN 复核。
-- - 迁移文件一旦在任何环境应用过就不可再修改，后续变更请追加新文件。

CREATE INDEX IF NOT EXISTS idx_topics_created_id
  ON topics (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_topics_author_created_id
  ON topics (author_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_replies_topic_created_id
  ON replies (topic_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_replies_author_created_id
  ON replies (author_id, created_at DESC, id DESC);
