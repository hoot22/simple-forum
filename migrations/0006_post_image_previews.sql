-- 0006: 列表缩略图（preview）独立存储。
--
-- 为什么由客户端生成缩略图：服务端运行在 Cloudflare Workers 上，运行时没有可用的
-- 图片编解码器。Cloudflare Image Resizing 需要付费且依赖已启用的 Zone，纯 JS/WASM
-- 解码又会超出免费层的 CPU 预算。因此缩略图由客户端在上传时一并提交，服务端只负责
-- 校验、存储与分发。
--
-- 为什么单独建表而不是给 post_images 加列：preview 只在列表页按需读取。独立成表可以
-- 保证既有查询（SELECT_COLUMNS / listByTopic）的行走宽度不变，永远不会意外把预览
-- 字节带出来；同时旧数据无需回填，没有 preview 的图片自动回退到原图。
CREATE TABLE post_image_previews (
  image_id INTEGER PRIMARY KEY,
  topic_id INTEGER NOT NULL,
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  data BLOB NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (byte_size > 0 AND byte_size <= 262144),
  CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp', 'image/gif'))
);

CREATE INDEX idx_post_image_previews_topic_id
  ON post_image_previews (topic_id);
