-- 发帖可选字体：保存字体标识，展示层据此套用对应 CSS 类。
-- 历史数据与无法识别的值一律按默认字体渲染（见 src/fonts/post-fonts.ts）。
-- 只新增列并带默认值：既有主题自动落到默认字体，不需要数据回填。
ALTER TABLE topics ADD COLUMN font TEXT NOT NULL DEFAULT 'default';
