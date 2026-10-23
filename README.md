# Simple Forum

[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Hono](https://img.shields.io/badge/Hono-4.13-E36002)](https://hono.dev/)
[![Cloudflare Pages](https://img.shields.io/badge/Cloudflare-Pages%20Functions-F38020?logo=cloudflare&logoColor=white)](https://developers.cloudflare.com/pages/)
[![Cloudflare D1](https://img.shields.io/badge/Cloudflare-D1-F38020?logo=cloudflare&logoColor=white)](https://developers.cloudflare.com/d1/)

一个轻量、服务端渲染的论坛，运行在 Cloudflare Pages Functions 上，数据存放在 D1（SQLite）。

设计取向是「少依赖」：

- **不需要额外存储服务**：图片与列表缩略图直接存 D1 BLOB，不需要 R2、对象存储或图床。
- **不需要构建步骤**：Pages Functions 直接运行 TypeScript，`pnpm deploy` 即上线。
- **默认不依赖 JavaScript**：浏览、发帖、回复、登录都是普通表单提交；脚本只负责图片预览、未读红点、公告弹窗和防重复提交。

## 功能

### 内容

- 主题列表（游标分页）、发帖、回复
- **嵌套回复**：可以回复某条评论，缩进一层；更深的回复归入同一楼层，并用「回复 @某人」标注对象
- **图片**：每帖最多 3 张、单张不超过 1 MiB，支持 JPEG / PNG / WebP / GIF；服务端按文件头（magic bytes）校验，列表使用单独生成的缩略图
- **发帖可选字体**：默认字体、文泉驿点阵宋
- **违禁词拦截**：发帖与回帖都会检查，命中则阻止发布、回填正文并弹窗说明

### 用户

- 注册 / 登录 / 登出：PBKDF2 密码哈希、HMAC 签名 Cookie 会话
- 个人主页：最近主题与最近回复，超过 4 条自动折叠
- 角色：论坛主（首个注册用户）、管理员、普通用户

### 通知与公告

- 主题被回复、评论被回复时收到通知，标题包含回复者，正文为内容摘要（过长自动截断）
- 导航栏未读红点，统计「通知 + 公告」合计
- 有新公告时自动弹窗；展示后标记已读，不会重复弹出
- 「通知与公告」页面分栏展示，管理员可在此发布公告

### 管理

- 主题置顶（独立区块展示，不参与分页）
- 设为 / 取消公告（同时写入一条公告通知）
- 删除主题：作者、管理员、论坛主均可
- 论坛主可设置 / 取消管理员

### 界面

- 暗色模式：跟随系统，也可手动切换并记住选择
- 移动端底部导航：首页 / 通知 / 个人
- 响应式布局，正文支持长串与图片自适应
- 时间统一按北京时间（UTC+8）显示

## 技术栈

| 层 | 选型 |
| --- | --- |
| 运行时 | Cloudflare Pages Functions（Workers） |
| 框架 | Hono 4.13 + Hono JSX（服务端渲染） |
| 数据库 | Cloudflare D1（SQLite），含 SQL 迁移 |
| 语言 | TypeScript 5.9（`strict`） |
| 测试 | Vitest 2.1 + Miniflare / workerd |
| 部署 | Wrangler 3 |

## 快速开始

### 环境要求

- Node.js 18 及以上（推荐 20 LTS）
- pnpm
- Cloudflare 账号（仅本地开发也需要 `wrangler login`，用于创建和使用本地 D1）

### 本地运行

```bash
pnpm install
pnpm exec wrangler login
pnpm db:migrate:local
```

新建 `.dev.vars`（该文件已被 `.gitignore` 忽略）：

```ini
SESSION_SECRET=本地开发用的随机字符串，至少32个字符
```

```bash
pnpm dev
```

默认访问 <http://localhost:8788>。

> `wrangler.jsonc` 中 `ENVIRONMENT` 为 `production`，应用会强制要求 `SESSION_SECRET` 不短于 32 个字符，因此本地也必须提供，否则启动即报错。

本地未绑定 D1 时，应用会回落到内存存储：功能可用，但进程重启后数据丢失，仅适合临时演示。

### 常用命令

| 命令 | 说明 |
| --- | --- |
| `pnpm dev` | 启动本地开发服务器（`wrangler pages dev public`） |
| `pnpm deploy` | 部署到 Cloudflare Pages |
| `pnpm typecheck` | TypeScript 类型检查（`tsc --noEmit`） |
| `pnpm test` | 运行全部测试（`vitest run`） |
| `pnpm db:migrate:local` | 应用迁移到本地 D1 |
| `pnpm db:migrate:remote` | 应用迁移到线上 D1 |

## 部署到 Cloudflare

### 1. 创建 D1 数据库

```bash
pnpm exec wrangler d1 create simple-forum-db
```

拿到 `database_id` 后，需要同步两处配置：

**（1）`wrangler.jsonc`**

```jsonc
{
  "binding": "DB",
  "database_name": "simple-forum-db",
  "database_id": "<上一步返回的 id>",
  "migrations_dir": "migrations"
}
```

`binding` 必须保持为 `DB`，代码以此访问数据库。

**（2）`package.json` 的迁移脚本**

`db:migrate:local` 与 `db:migrate:remote` 目前把库名写死为 `users`：

```jsonc
"db:migrate:local": "wrangler d1 migrations apply users --local",
"db:migrate:remote": "wrangler d1 migrations apply users --remote"
```

请把其中的 `users` 换成你实际创建的库名；或者反过来，把数据库直接命名为 `users`，就不用改脚本。

> 仓库中的 `wrangler.jsonc` 已把 `database_id` 写成占位符 `REPLACE_WITH_YOUR_D1_DATABASE_ID`。**部署前必须替换为你自己的 ID**，否则 wrangler 会因找不到数据库而失败；替换后不要把这个改动提交。

### 2. 应用迁移

```bash
pnpm db:migrate:remote
```

仓库中有多份增量迁移，必须全部应用，不能只执行初始化脚本。

### 3. 创建 Pages 项目（仅首次）

```bash
pnpm exec wrangler pages project create simple-forum --production-branch main
```

若不使用 `simple-forum` 这个项目名，需同步修改 `package.json` 的 `deploy` 脚本中的 `--project-name`。

### 4. 配置密钥

```bash
pnpm exec wrangler pages secret put SESSION_SECRET --project-name simple-forum
```

输入一个足够长的随机值（至少 32 个字符），例如：

```bash
openssl rand -base64 48
```

生产环境下若缺少 D1 绑定或 `SESSION_SECRET` 长度不足，应用会按安全策略拒绝启动。

### 5. 部署

```bash
pnpm deploy
```

成功后 Wrangler 会输出访问地址，通常为 `https://simple-forum.pages.dev`。若名称被占用，以实际输出为准。

### 环境变量

| 名称 | 类型 | 必需 | 说明 |
| --- | --- | --- | --- |
| `DB` | D1 绑定 | 生产必需 | 未绑定时回落到内存存储 |
| `SESSION_SECRET` | Secret | 生产必需 | 用于签名会话 Cookie，至少 32 个字符 |
| `SESSION_SECRET_PREVIOUS` | Secret | 可选 | 密钥轮换过渡期内，旧密钥仍可验证 |
| `ENVIRONMENT` | 变量 | 建议 | 设为 `production` 时启用生产环境校验 |

`SESSION_SECRET` 不要写进代码或提交到仓库。轮换密钥时，先把旧值放进 `SESSION_SECRET_PREVIOUS`、新值放进 `SESSION_SECRET`，等旧会话自然过期后再移除旧值。

## 自定义

| 想改什么 | 改哪里 |
| --- | --- |
| 违禁词 | `src/moderation/banned-words.ts`（只有词条，检测逻辑在 `word-filter.ts`） |
| 发帖可选字体 | `src/fonts/post-fonts.ts` + `public/fonts/` 下的字体文件 |
| 页脚联系方式 / 友情链接 | `src/site/footer.ts`（仅首页展示） |
| 配色（日间 / 夜间） | `src/views/layout.tsx` 顶部的 CSS 变量 |
| 站点名称 | `src/views/layout.tsx` |

几点说明：

- **违禁词**：匹配前会做归一化（全角转半角、忽略大小写与空白标点），所以 `违 禁 词`、`违-禁-词` 同样会被命中。词库是打包进 Worker 的，改完需要重新部署。留空数组即关闭该功能。
- **字体**：两个内置字体都是点阵字体，只在其设计尺寸下点对点清晰，所以对应的 CSS 类固定了字号与行高；新增字体时除了清单，还要补 `@font-face` 与静态文件。
- **页脚**：`{ label, value }` 为纯文本展示，`{ label, href }` 为链接；留空则对应区块整体不渲染。

## 项目结构

```text
├── functions/
│   └── [[path]].ts          # Pages Functions 入口：把请求交给 Hono
├── migrations/              # D1 迁移，按文件名顺序应用
├── public/                  # 静态资源，原样发布
│   ├── _routes.json         # 声明哪些路径不经过 Functions
│   ├── fonts/               # 发帖可选字体
│   ├── icons/               # 图标
│   └── js/                  # 增强脚本（无脚本时核心功能仍可用）
├── src/
│   ├── app.ts               # Hono 装配：中间件、路由、依赖注入
│   ├── env.ts               # 绑定与密钥类型
│   ├── types.ts             # 领域类型
│   ├── db/                  # 存储接口 + D1 / 内存两套实现
│   ├── routes/              # pages.tsx（SSR 页面）、api.ts（JSON 接口）
│   ├── services/            # 领域逻辑：auth / forum / profile / admin / roles
│   ├── views/               # Hono JSX 视图与样式
│   ├── middleware/          # CSRF、限流、安全响应头
│   ├── moderation/          # 违禁词数据与匹配
│   ├── uploads/             # 图片校验、图片与缩略图存储
│   ├── fonts/               # 可选字体清单
│   ├── site/                # 页脚联系方式与友情链接
│   └── utils/               # 会话、密码、时间、参数校验
├── test/                    # Vitest 测试，含内存与真实 D1 契约测试
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── wrangler.jsonc
```

路由层只做「解析参数 → 调用服务 → 渲染或重定向」，业务规则集中在 `src/services/`，存储层通过 `ForumStore` 接口抽象，D1 与内存两套实现共享同一份契约测试。

## HTTP 接口

页面路由为服务端渲染，例如 `/`、`/topics/:id`、`/topics/new`、`/me`、`/users/:id`、`/notifications`。JSON 接口统一以 `/api` 为前缀：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/topics` | 主题列表（游标分页） |
| `POST` | `/api/topics` | 创建主题（JSON） |
| `GET` | `/api/topics/:id` | 主题详情 |
| `POST` | `/api/topics/:id/replies` | 发表回复（JSON） |
| `POST` | `/api/auth/register` | 注册 |
| `POST` | `/api/auth/login` | 登录 |
| `POST` | `/api/auth/logout` | 登出 |
| `GET` | `/api/me` | 当前登录用户 |
| `POST` | `/api/users/:id/admin` | 设置 / 取消管理员（仅论坛主） |
| `GET` | `/api/notifications` | 通知与公告列表 |
| `GET` | `/api/notifications/unread` | 未读数（通知 + 公告） |
| `GET` | `/api/announcements/unread` | 未读公告 |
| `POST` | `/api/announcements/read` | 标记公告已读 |

图片通过同源路由 `GET /media/posts/:id` 读取，不暴露内部存储结构。

## 数据表

| 表 | 用途 |
| --- | --- |
| `users` | 账号、密码哈希、管理员标记 |
| `topics` | 主题、字体、置顶与公告标记 |
| `replies` | 回复，`parent_reply_id` 支持一层嵌套 |
| `post_images` | 图片二进制（BLOB）、类型与大小 |
| `post_image_previews` | 列表缩略图（BLOB） |
| `notifications` | 通知与公告，`user_id` 为空即公告 |
| `notification_reads` | 按用户记录已读状态 |

迁移文件按文件名排序执行。新增迁移请从 `0010` 起编号（`0006` 目前有两份，分别对应通知与缩略图）。

## 测试

```bash
pnpm typecheck
pnpm test
```

测试覆盖路由行为、服务层规则、视图结构、安全中间件，以及存储层契约。其中 `test/repository.d1.test.ts` 会在 workerd 内启动一个真实的 D1 实例，验证迁移、参数绑定和 BLOB 读写——因此它要求本机能正常启动 workerd。

## 安全设计

- 密码使用 PBKDF2 哈希，不存明文，也不记录到日志
- 会话为 HMAC 签名 Cookie（`HttpOnly`、`SameSite=Lax`，HTTPS 下加 `Secure`，有效期 7 天）
- 所有写操作校验 CSRF Token
- 注册、登录、发帖等接口有频率限制
- 统一安全响应头：CSP（显式声明 `font-src`、`connect-src`）、HSTS、`X-Content-Type-Options` 等
- 上传图片同时校验 MIME、扩展名与文件头，拒绝 SVG 与其他未知格式
- 页面输出经 JSX 转义，脚本中写 DOM 使用 `textContent`

## 已知限制

- 限流是**单实例内存**计数，多实例之间不共享；冷启动后归零
- 会话是**无状态签名 Cookie**，修改密码后无法主动吊销其他设备（需要服务端版本号，属后续迭代）
- 图片存放在 D1，受单行体积限制，所以单张上限为 1 MiB；大量图片会明显增加数据库体积与查询成本
- 没有邮箱验证、找回密码、内容编辑与全文搜索
- 尚未配置 lint / format / CI 流水线

## 贡献

欢迎提 Issue 与 Pull Request。提交前请执行：

```bash
pnpm typecheck
pnpm test
```

请保持现有分工：路由薄、规则在服务层、存储通过接口访问；同一规则只保留一处实现。

## 许可与第三方资源

**本项目以 MIT 许可证发布**，全文见 [`LICENSE`](LICENSE)。`LICENSES/` 目录下的文本只随附字体使用，不适用于本项目代码。

### 字体

| 字体 | 授权 | 是否随仓库分发 |
| --- | --- | --- |
| 文泉驿点阵宋 | GPL-2.0 | 是，许可见 [`LICENSES/GPL-2.0.txt`](LICENSES/GPL-2.0.txt) |

- **文泉驿点阵宋**：原版由 WenQuanYi Project 发布（GPL-2.0，含字体嵌入例外），仓库使用的是
  [AmusementClub/WenQuanYi-Bitmap-Song-TTF](https://github.com/AmusementClub/WenQuanYi-Bitmap-Song-TTF)
  提供的 TTF 转换版。该字体文件保持 GPL-2.0，不适用本项目代码的许可证；它以独立静态资源形式提供，
  与代码属于聚合分发。
- **最像素 Zpix**：其上游条款为个人与教育用途免费、商业用途付费，并禁止未经许可的传播，不属于可自由
  再分发的许可证。因此本项目**不包含、也不提供**该字体，发帖页不显示该选项。若在自建实例中启用，
  需自行取得授权，并同时修改 `src/fonts/post-fonts.ts` 与 `layout.tsx` 中的 `@font-face`。

详细说明见 [`public/fonts/README.md`](public/fonts/README.md)。

### 开源发布前检查

- [ ] 部署前把 `wrangler.jsonc` 的 `database_id` 占位符替换为自己的 ID（该改动不要提交）
- [ ] 确认 `.dev.vars`、`*.log`、`.wrangler/` 等未被提交
- [ ] 按需清空 `src/site/footer.ts` 中的个人信息与友情链接
- [ ] 按需调整 `src/moderation/banned-words.ts` 词库
- [ ] 更换站点名称与配色

