CREATE TABLE post_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id INTEGER NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE,
  CHECK (byte_size > 0 AND byte_size <= 5242880),
  CHECK (width > 0 AND width <= 12000),
  CHECK (height > 0 AND height <= 12000),
  CHECK (position >= 0 AND position < 3),
  CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp', 'image/gif')),
  UNIQUE (topic_id, position)
);

CREATE INDEX idx_post_images_topic_position
  ON post_images (topic_id, position);
