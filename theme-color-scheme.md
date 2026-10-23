# Daedalus Studio 明暗主题配色方案

本文档汇总 Studio 当前的暗色与亮色配色，作为新增或修改界面时挑选色值的参照。所有颜色必须通过 `--ds-*` token 或 Ant Design `ConfigProvider` 主题使用，不要在组件中新增散落的 hex 色值。

## 1. 颜色来源与生效链路

配色分四层，越靠后优先级越高：

| 层 | 位置 | 作用 |
| --- | --- | --- |
| CSS token 兜底 | `src/renderer/src/ui/styles/theme.css:111-212` | `:root` 写暗色基准值，`:root[data-theme="light"]` 整体覆盖 |
| 预加载注入 | `src/preload/index.ts:190-214` | 页面脚本执行前写入 `data-theme` 与内联 accent 变量 |
| 强调色算法 | `src/contracts/theme-color.ts:52-81` | 由用户主题色派生 hover / active / muted / subtle / 对比字色 |
| Ant Design | `src/renderer/src/ui/styles/studio-theme.ts:45-128` | 同一批色值映射为 antd token，按模式选择算法 |

补充说明：

- 暗色是**默认值**：`data-theme` 缺失时按暗色渲染（`src/renderer/src/widgets/computer-observation/ComputerOverlay.module.css:11` 依赖该约定做首帧隐藏）。
- 亮色只覆盖颜色变量，圆角、间距、字号、字体两模式一致（`src/renderer/src/ui/styles/theme.css:141-162`）。
- 远程 Web / Android 端没有 preload，`src/renderer/src/remote/RemoteProviders.tsx:84-99` 在 React 挂载后才应用变量，首帧短暂使用 CSS 兜底值；该端主题只跟随系统，且主题色固定为默认值。

### 主题模式与主题色

| 项 | 取值 | 存储与切换 |
| --- | --- | --- |
| 模式 `theme` | `system` / `light` / `dark` | 客户端偏好；主进程同步 `nativeTheme.themeSource`（`src/main/index.ts:253`） |
| 主题色 `themeColor` | 任意 `#rrggbb`，默认 `#478cbf` | 客户端偏好；设置页 `src/renderer/src/widgets/settings/pages/studio/AppearanceSettingsPage.tsx:237-273` |

`system` 的解析：主进程用 `nativeTheme.shouldUseDarkColors`（`src/main/services/window-theme.ts:11-19`），渲染进程用 `prefers-color-scheme`（`src/renderer/src/features/application/hooks/useClientPreferencesController.ts:19`）。

## 2. 基础色板（暗色 / 亮色）

| Token | 用途 | 暗色 | 亮色 |
| --- | --- | --- | --- |
| `--ds-bg` | 应用基础背景、滚动条轨道 | `#141414` | `#f5f5f5` |
| `--ds-bg-tint` | 内容区半透明底、页面遮罩 | `rgba(20, 20, 20, 0.9)` | `rgba(255, 255, 255, 0.9)` |
| `--ds-bg-tint-opacity` | 上述 tint 的透明度，可由用户调整 | `0.9` | `0.9` |
| `--ds-bg-sunken` | 输入框、代码块、终端、低层级内容 | `#1b1b1b` | `#e8e8e8` |
| `--ds-code-bg` | Markdown 行内 code 背景 | `#ffffff1d` | `#14141414` |
| `--ds-surface` | 普通面板、卡片、Composer | `#1b1b1b` | `#ffffff` |
| `--ds-surface-elevated` | Dropdown、Popover、菜单、Modal | `#1f1f1f` | `#ffffff` |
| `--ds-surface-hover` | hover 背景 | `#242424` | `#f0f0f0` |
| `--ds-surface-active` | active / selected 背景、用户气泡 | `#2a2a2a` | `#e3e3e3` |
| `--ds-border` | 标准边框、分隔线、表头背景 | `#3b3b3b` | `#d6d6d6` |
| `--ds-border-subtle` | 次级分隔线 | `#3b3b3b` | `#d6d6d6` |
| `--ds-text-primary` | 主文字、终端前景 | `#e8e8e8` | `#141414` |
| `--ds-text-secondary` | 次级文字 | `#b8b8b8` | `#4f4f4f` |
| `--ds-text-muted` | 弱提示、meta 信息、滚动条 hover | `#8c8c8c` | `#737373` |
| `--ds-text-inverse` | 反色文字（强调色之上的文字） | `#ffffff`（运行时按强调色亮度可能为 `#141414`） | 同左 |
| `--ds-danger` | 错误、危险操作 | `#ff4d4f` | `#ff4d4f`（未覆盖） |
| `--ds-warning` | 警告、搜索命中 | `#faad14` | `#faad14`（未覆盖） |
| `--ds-success` | 成功 | `#52c41a` | `#52c41a`（未覆盖） |
| `--ds-git-addition` | Git 增加行文字/数量 | `#3fb950` | `#1a7f37` |
| `--ds-git-deletion` | Git 删除行文字/数量 | `#ff7b72` | `#cf222e` |
| `--ds-git-addition-bg` | Git 增加区域弱背景 | `rgb(63 185 80 / 14%)` | `rgb(26 127 55 / 12%)` |
| `--ds-git-deletion-bg` | Git 删除区域弱背景 | `rgb(255 123 114 / 14%)` | `rgb(207 34 46 / 12%)` |
| `--ds-box-shadow` | 浮层投影 | **未定义**（计算值退化为 `none`） | `0 8px 16px #0000000f` |
| `color-scheme` | 原生滚动条与表单控件配色 | `dark` | `light` |

语义色 `danger` / `warning` / `success` 目前两模式共用同一组值，亮色下若需更高对比度需单独覆盖。

## 3. 强调色（主题色）派生

默认主题色 `DEFAULT_STUDIO_THEME_COLOR = #478cbf`（`src/contracts/theme-color.ts:3`）。用户在设置页选定任意 `#rrggbb` 后，由 `createStudioAccentPalette` 派生整组强调色：

| 变量 | 派生规则（暗色 / 亮色） |
| --- | --- |
| `--ds-accent` | 用户所选色原值 |
| `--ds-accent-hover` | 向白 `mix(color, 255)`，暗色 `16%`、亮色 `12%` |
| `--ds-accent-active` | 向黑 `mix(color, 0)`，暗色 `18%`、亮色 `14%` |
| `--ds-accent-muted` | 同色透明，暗色 `24%`、亮色 `18%`（选中态、弱强调底） |
| `--ds-accent-subtle` | 同色透明，暗色 `14%`、亮色 `10%`（更弱的提示底） |
| `--ds-text-inverse` | 相对亮度 `> 0.62` 时 `#141414`，否则 `#ffffff` |

默认色在两模式下的实际取值（运行时内联，覆盖 CSS 兜底值）：

| 变量 | 暗色 | 亮色 | `theme.css` 静态兜底 |
| --- | --- | --- | --- |
| `--ds-accent` | `#478cbf` | `#478cbf` | 暗 `#478cbf` / 亮 `#59a0d6` |
| `--ds-accent-hover` | `#649ec9` | `#5d9ac7` | 两模式均 `#5aa0d2` |
| `--ds-accent-active` | `#3a739d` | `#3d78a4` | 暗 `#386f98` / 亮 `#1c70b0` |
| `--ds-accent-muted` | `rgb(71 140 191 / 24%)` | `rgb(71 140 191 / 18%)` | 同算法 |
| `--ds-accent-subtle` | `rgb(71 140 191 / 14%)` | `rgb(71 140 191 / 10%)` | 同算法 |
| `--ds-text-inverse` | `#ffffff` | `#ffffff` | 两模式 `#ffffff` |

`#478cbf` 的相对亮度为 `0.506`，低于 `0.62` 阈值，因此默认主题色始终配白色前景文字。

## 4. 原生窗口、毛玻璃与背景叠加层

| 项 | 暗色 | 亮色 | 位置 |
| --- | --- | --- | --- |
| 原生窗口背景 | `#141414` | `#f5f5f5` | `src/main/services/window-theme.ts:21-35` |
| 标题栏浮层颜色 | `#ffffff00` | `#ffffff00` | 同上（Windows/macOS 上窗口本身另用全透明背景 `#00000000`） |
| 标题栏符号色 | `#e8e8e8` | `#141414` | 同上 |
| 毛玻璃不透明度 | `0.7` | `0.64` | `src/renderer/src/app/shell/SharedVisualProviders.tsx:66-71`，窗口设为不透明时为 `1` |
| 毛玻璃底色 | `rgb(20 20 20 / 不透明度)` | `rgb(245 245 245 / 不透明度)` | `src/renderer/src/ui/styles/theme.css:139,209` |
| 玻璃高光 | `rgb(255 255 255 / 7%)` | `rgb(255 255 255 / 58%)` | `src/renderer/src/ui/styles/theme.css:140,210`（当前无消费方） |
| 背景图叠加层 | 不区分模式：默认 `opacity 0.4`、`blur 0px`、`cover` | 同左 | `src/renderer/src/ui/ContentBackground.module.css:13-19`、`src/contracts/appearance-background.ts:37-51` |

窗口底色与毛玻璃层共同决定窗口观感：`--ds-window-glass-tint` 铺在 `WindowProviders` 根节点（`src/renderer/src/app/shell/WindowProviders.module.css:11`），背景图叠加层再通过 `--ds-bg-tint` 压暗/提亮到内容区。

## 5. 子系统配色

### 终端

`src/renderer/src/widgets/terminal/TerminalPanel.tsx:37-61`：主题基本复用 token，仅 ANSI 个别色写死。

| 项 | 取值 |
| --- | --- |
| 背景 / 前景 | `--ds-bg-sunken` / `--ds-text-primary` |
| 光标 / 选区 | `--ds-accent` / `--ds-accent-muted` |
| red / green / yellow / blue | `--ds-danger` / `--ds-success` / `--ds-warning` / `--ds-accent` |
| magenta / brightMagenta | `#c678dd` / `#d19aef`（固定） |
| cyan / brightCyan | `#56b6c2` / `#66d9ef`（固定） |
| black / brightBlack | 暗色 `--ds-bg` / `--ds-text-muted`；亮色 `--ds-text-primary` / `--ds-text-secondary` |
| brightBlue / brightWhite | `--ds-accent-hover` / `--ds-text-inverse` |

### Monaco 编辑器

`src/renderer/src/widgets/files/MonacoFileEditor.tsx:113-162`，亮色基于 `vs`、暗色基于 `vs-dark`。

| 元素 | `daedalus-light` | `daedalus-dark` |
| --- | --- | --- |
| 浮层背景 / 文字 / 边框 | `#ffffff` / `#1f2937` / `#d9d9d9` | `#202124` / `#f3f4f6` / `#4b5563` |
| 输入框背景 / 边框 | `#ffffff` / `#d9d9d9` | `#292a2d` / `#4b5563` |
| 输入建议选中 | `#e8f1ff` / `#2563eb` | `#263b63` / `#93c5fd` |
| 查找命中 / 其余命中 | `#ffd84d66` / `#ffd84d33` | `#eab30866` / `#eab30833` |
| 查找命中边框 | `#d6a700` | `#facc15` |

### Mermaid 图表

`src/renderer/src/widgets/markdown/MermaidBlock.tsx:30-44` 读取 token，`src/renderer/src/widgets/markdown/mermaid-renderer.ts:20-68` 以 `theme: "base"` 组装：背景 `--ds-bg`、主节点 `--ds-surface`、次节点 `--ds-bg-sunken`、边框 `--ds-border`、连线 `--ds-text-secondary`、激活边框 `--ds-accent`。`darkMode` 仅在暗色下为 `true`。

### Git 差异

`src/renderer/src/widgets/git/review/GitDiffReviewPanel.module.css:10-23` 把 react-diff-view 的 `--diff-*` 变量重绑到 `--ds-git-*` 与 `--ds-text-*`；行内预览、工具卡片、首页统计使用 `--ds-git-addition` / `--ds-git-deletion`。

### 用户气泡与主要容器

| 元素 | 配色 |
| --- | --- |
| 用户气泡 | 底 `--ds-surface-active`、圆角 `--ds-radius-lg`（`src/renderer/src/widgets/conversation/UserBubble.module.css:30-58`） |
| 弹层（Dropdown/Popover/Modal） | 底 `--ds-surface-elevated`、边框 `--ds-border` |
| antd Menu | 自身背景透明、hover 底 `--ds-surface-hover`、选中底 `--ds-accent-muted`、选中字色 `--ds-text-primary` |
| 导航项（远程 / 移动端） | 未选中 `--ds-text-muted`、选中 `--ds-accent`，顶部指示条 `--ds-accent`（`src/renderer/src/remote/RemoteApp.module.css:470-504`） |
| 搜索命中 / 当前命中 | `color-mix(--ds-warning 42%)` / `--ds-accent` 底 + `--ds-text-inverse` 字 |

## 6. Ant Design 映射

`src/renderer/src/ui/styles/studio-theme.ts:95-183` 将上述色值映射到 antd，并附组件级调整：

| antd token | 取值 |
| --- | --- |
| `colorBgBase` / `colorBgLayout` | `--ds-bg` |
| `colorBgContainer` | `--ds-surface` |
| `colorBgElevated` | `--ds-surface-elevated` |
| `colorFillQuaternary` | `--ds-surface-hover` |
| `colorBorder` / `colorBorderSecondary` | `--ds-border` |
| `colorPrimary` / `Hover` / `Active` | 强调色三档 |
| `colorText` / `Secondary` / `Tertiary` | `--ds-text-primary` / `-secondary` / `-muted` |
| `algorithm` | 暗色 `darkAlgorithm`、亮色 `defaultAlgorithm` |

组件级：Menu 自身背景透明、选中底用 `--ds-accent-muted`、hover 底用 `--ds-surface-hover`；Tree 选中底同为 `--ds-accent-muted`；Button 无阴影；Modal/Card 内边距 `8px`。移动端变体（`data-theme-variant="mobile"`）额外放大圆角与控制高度（`src/renderer/src/ui/styles/theme.css:171-178`）。

## 7. 与主题模式无关的固定色板

以下颜色刻意不参与明暗切换，改动时无需成对修改：

- Mascot 形象：`#347fff` 主体蓝、`#43464c → #111216` 深色渐变（`src/renderer/src/widgets/mascot/Mascot.module.css:26-175`）。
- 统计热力图三档绿：`#39d353` / `#26a641` / `#216e39`（`src/renderer/src/widgets/settings/pages/studio/StatisticsSettingsPage.module.css:172-188`）。
- 浏览器扩展状态页：使用 `color-scheme: light dark` 交由浏览器默认配色（`src/browser-extension/status.css:1-4`）。
- Android 远程控制图标色：`#1677FF` / `#F5F5F5`（`android/remote-control/app/src/main/res/values/colors.xml`）。

## 8. 新增 UI 时的检查项

1. 颜色优先取 `--ds-*` token，不新增 hex；语义色走 `--ds-danger` / `--ds-warning` / `--ds-success`。
2. 弹层用 `--ds-surface-elevated` + `--ds-border`；输入与代码块用 `--ds-bg-sunken`。
3. 强调色相关一律使用 `--ds-accent*` 变量，不要写死 `#478cbf`。
4. 明暗两模式都要验证：只覆盖一个模式的色值必须落在亮色块里，避免暗色默认值漏到亮色。
5. 阴影统一走 `--ds-box-shadow`，并确保两个模式都有定义。

## 附录：已知偏差（待修复，独立跟踪）

以下为文档核对时记录的实际偏差，修复后再回填本文档：

1. `--ds-box-shadow` 只在亮色块定义，暗色下 18 处 `box-shadow: var(--ds-box-shadow)` 计算为 `none`。
2. `src/renderer/src/widgets/markdown/MarkdownContent.tsx:19` 无条件加载 `highlight.js/styles/github-dark.css`，亮色模式语法高亮仍是暗色配色。
3. `theme.css` 静态强调色与派生算法结果不一致（hover 两模式均写 `#5aa0d2`，实际为 `#649ec9` / `#5d9ac7`），远程 Web 首帧可见。
4. `src/renderer/src/widgets/git/review/GitDiffReviewPanel.module.css:18-23` 的 edit / selection 背景写死暗色 RGB，亮色不跟随。
5. `src/renderer/src/ui/styles/global.css:11-18` 启动指示器写死 `#478cbf`，不随自定义主题色变化。
6. `--ds-window-glass-highlight` 已定义（两模式各一处）但无任何消费方。
