-- 0005: 图片字节改为直接存放在 D1 的 BLOB 列中。
--
-- 此前的 post_images 表依赖 object_key + R2 对象存储，在没有绑定 R2 的
-- 环境中写入必然失败，因此表中不应存在有效数据。这里直接重建该表：
-- 元数据和字节放在同一行，读取时由 D1 返回字节。
DROP TABLE IF EXISTS post_images;

CREATE TABLE post_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id INTEGER NOT NULL,
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  position INTEGER NOT NULL,
  data BLOB NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE,
  CHECK (byte_size > 0 AND byte_size <= 1048576),
  CHECK (position >= 0 AND position < 3),
  CHECK (
    content_type IN (
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif'
    )
  ),
  UNIQUE (topic_id, position)
);

CREATE INDEX idx_post_images_topic_position
  ON post_images (topic_id, position);
