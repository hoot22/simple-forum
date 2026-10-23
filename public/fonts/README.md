# 网页字体

发帖字体的清单定义在 [`src/fonts/post-fonts.ts`](../../src/fonts/post-fonts.ts)，`@font-face` 声明与
`.post-font-*` 样式规则在 [`src/views/layout.tsx`](../../src/views/layout.tsx)。

Pages 只部署 `public/` 目录，所以字体文件必须放在本目录才能被访问到；`public/_routes.json`
已放行 `/fonts/*`，不需要额外配置。

## 当前提供的字体

| 文件 | 字体 | 授权 |
| --- | --- | --- |
| `WenQuanYi.Bitmap.Song.16px.ttf` | 文泉驿点阵宋 16px | GPL-2.0，全文见 [`LICENSES/GPL-2.0.txt`](../../LICENSES/GPL-2.0.txt) |

GPL-2.0 允许再分发，条件是随附许可证全文；该字体以独立静态资源形式提供，与项目代码属于聚合分发，
不影响代码自身的许可证。

点阵字体只有在设计尺寸下才点对点清晰，因此 `.post-font-wqy` 固定了字号 `16px` 与行高 `24px`。
要放大请使用设计尺寸的整数倍，非整数倍会插值出模糊边缘。

## 已移除的字体

**最像素 Zpix** 已从本项目移除，`zpix.ttf` 不再存在，发帖页也不显示该选项。

移除原因是授权：其上游条款为个人与教育用途免费、商业用途付费，并禁止未经许可的传播，
不属于可自由再分发的许可证。

历史数据无需处理：`toPostFontId()` 会把任何不在清单内的值归一化为默认字体，所以旧帖中
`font = 'zpix'` 的记录会按默认字体渲染，不会报错。

## 添加新字体

1. 将字体文件放入本目录。
2. 在 `src/fonts/post-fonts.ts` 的 `POST_FONTS` 中增加条目，填写 `id` / `label` / `className` / `hint` / `file`。
3. 在 `src/types.ts` 的 `PostFontId` 联合类型中补上同一个 `id`。
4. 在 `layout.tsx` 中增加对应的 `@font-face` 与 `.post-font-*` 规则。
5. 确认为可自由再分发的授权，并把许可证文本放入 `LICENSES/`。

注意部分像素字体对汉字覆盖不完整，正文可能出现逐字回退导致的混排，上线前请用实际内容验证。
