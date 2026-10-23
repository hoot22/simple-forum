# 客户端 API 契约

面向 Web、安卓等外部客户端的稳定接口说明。

**边界**：客户端只依赖 `/api/*` 与 `/media/posts/:id`。页面路由（`/login`、`/topics/...` 等）返回服务端渲染的 HTML，随时可能调整，**不属于契约范围**。

字段只增不减：新增字段视为向后兼容改动，客户端必须忽略不认识的字段，不要因为多出一个字段就报错。

---

## 1. 通用约定

- 所有 `/api/*` 端点返回 `application/json; charset=utf-8`。
- 错误统一为 `{ "error": string }`。
- **限流（429）是唯一例外**：它返回 `text/plain` 而不是 JSON，并带 `Retry-After` 头。
  客户端处理 429 时必须容错，不能无条件按 JSON 解析响应体；等待时长应读取 `Retry-After`，
  不要硬编码配额。
- 错误文案只是给用户看的提示，**客户端应当按状态码分支，不要匹配具体字符串**。
- 时间字段是 UTC 字符串，展示时由客户端按本地时区转换。

---

## 2. 认证与 CSRF

登录成功后服务端下发两个 Cookie：

| Cookie | 用途 | HttpOnly |
|---|---|---|
| `forum_session` | 会话凭据，真正的鉴权依据 | 是 |
| `forum_csrf` | CSRF 令牌（双提交模式） | **否**，同源脚本可读 |

写请求（`POST` / `DELETE`，即非 GET/HEAD/OPTIONS）必须同时满足两个条件：

1. 带上 `forum_session` 与 `forum_csrf` 两个 Cookie；
2. 带请求头 `x-csrf-token: <forum_csrf 的值>`。

表单提交场景也可以用隐藏字段 `_csrf` 代替请求头；JSON 与 multipart 请求请用请求头。

客户端注意事项：

- 两个 Cookie 都要持久化。`forum_csrf` 不是 HttpOnly，因此安卓端可以从响应中直接读取；
- **没有刷新令牌机制**。会话失效只能重新登录，所以必须统一拦截 401 并跳转登录页；
- 令牌本身不是凭据：真正的凭据是 HttpOnly 的 `forum_session`。

### 认证端点响应体

注册、登录、`GET /api/me` 成功时返回同一个形状：

```json
{
  "user": {
    "id": 1,
    "username": "alice",
    "createdAt": "2026-09-13 10:22:31",
    "isAdmin": false
  }
}
```

`passwordHash` 只存在于服务端内部记录，**任何响应都不携带该字段**。论坛主
（最早注册的账户）不依赖 `isAdmin`，客户端需要用 `GET /api/me` 之外的信息自行判定时，
应以服务端返回的权限判定结果为准，不要本地推断。

| 端点 | 成功 | 失败 |
|---|---|---|
| `POST /api/auth/register` | 201 `{ user }` | 400 `{ error }` 校验失败；409 `{ error }` 用户名已被注册 |
| `POST /api/auth/login` | 200 `{ user }` | 400 `{ error }` 缺少字段；401 `{ error }` 用户名或密码错误 |
| `POST /api/auth/logout` | 200 `{ ok: true }` | — |
| `GET /api/me` | 200 `{ user }` | 401 `{ error }` 未登录 |

注册成功后即下发会话 Cookie，客户端不需要再调一次登录。

---

## 3. 端点

认证列含义：公开 = 无需登录；会话 = 需要 `forum_session`；写 = 同时需要 CSRF 令牌。

| 方法 | 路径 | 认证 | 限流（每 IP） | 说明 |
|---|---|---|---|---|
| POST | `/api/auth/login` | 公开 | 10 次 / 15 分钟 | 登录，成功后下发 Cookie |
| POST | `/api/auth/register` | 公开 | 5 次 / 小时 | 注册 |
| POST | `/api/auth/logout` | 会话 | — | 登出并清除 Cookie |
| GET | `/api/me` | 会话 | — | 当前用户；未登录返回 401 |
| GET | `/api/topics` | 公开 | — | 主题列表，支持 `cursor` / `limit` / `sort`；每项含 `imageCount` / `firstImageId` / `hasPreview` |
| GET | `/api/topics/:id` | 公开 | — | 主题详情，含图片元数据（带 `hasPreview`）与回复分页 |
| GET | `/api/users/:id/profile` | 公开 | — | 个人页聚合：资料、统计、最近主题、最近回复；`limit` 控制每个列表条数（默认 10） |
| GET | `/api/notifications` | 登录 | — | 通知/公告列表，`kind`=`notification`\|`announcement`（默认前者），支持 `cursor` / `limit`；每项含相对当前用户的 `read`；只读，不标记已读 |
| POST | `/api/topics` | 写 | 20 次 / 小时 | 发主题（JSON，不含图片） |
| DELETE | `/api/topics/:id` | 写 | 30 次 / 小时 | 删除主题（作者或管理员） |
| POST | `/api/topics/:id/replies` | 写 | 60 次 / 小时 | 回复 |
| POST | `/api/topics/:id/images` | 写 | 40 次 / 小时 | 上传图片（multipart，可附 `previews`） |
| DELETE | `/api/images/:id` | 写 | 60 次 / 小时 | 删除单张图片（作者或管理员），同时清理其缩略图 |
| GET | `/media/posts/:id` | 公开 | — | 读取图片字节；`?size=preview` 取缩略图。**不在 `/api/*` 下** |

`sort` 只接受 `newest`（默认）与 `active`，非法值按 `newest` 处理。

配额是服务端配置，可能调整。

---

## 4. 主题对象

`GET /api/topics` 响应：

```json
{
  "topics": [ /* Topic[] */ ],
  "nextCursor": "…",
  "prevCursor": null
}
```

`Topic` 字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | number | |
| `title` | string | |
| `content` | string | 纯文本 |
| `authorId` | number \| null | 无作者时为 null |
| `author` | string | 解析后的作者名，缺省为「匿名」 |
| `createdAt` | string | UTC |
| `replyCount` | number | |
| `lastActivityAt` | string | 最后活动时间 |
| `pinned` | boolean | |
| `isAnnouncement` | boolean | |
| `imageCount` | number | 该主题图片总数，0 表示无图 |
| `firstImageId` | number \| null | `position` 最小的一张的 id；无图时为 `null` |
| `hasPreview` | boolean | 封面图（`firstImageId`）是否存在缩略图；无图时为 `false` |

**列表页图片显示**：`firstImageId` 不为 `null` 时，用 `GET /media/posts/{firstImageId}` 取图；
`imageCount > 1` 时可用它渲染「+N」角标；为 `null` 时零额外请求。

> 列表只给「有几张 + 哪张当缩略图」。要完整的图片数组请读详情接口。
> `hasPreview` 描述的是封面图：为 true 时对 `GET /media/posts/{firstImageId}?size=preview`
> 取小图，为 false 时直接取原图。该字段由一次批量查询得出，图片数量再多也不会增加往返次数，
> 客户端无需为探测缩略图额外请求详情。

`GET /api/topics/:id` 响应：

```json
{
  "topic": { /* Topic，额外带 images */ },
  "replies": [ /* Reply[] */ ],
  "repliesNextCursor": "…",
  "repliesPrevCursor": null
}
```

`topic.images` 是 `PostImage[]`（只有元数据，**不含字节**）：

| 字段 | 类型 |
|---|---|
| `id` | number |
| `topicId` | number |
| `contentType` | string |
| `byteSize` | number |
| `width` / `height` | number \| null |
| `position` | number |
| `createdAt` | string |
| `hasPreview` | boolean |

**必须成立的不变量**：`topic.imageCount === topic.images.length`，
且 `topic.firstImageId === (topic.images[0]?.id ?? null)`。
列表和详情走两条不同查询，这条不变量是它们唯一的粘合剂。

---

## 5. 图片

### 上传 `POST /api/topics/:id/images`

- 请求体：`multipart/form-data`，字段名 `images`（可重复）；兼容单值 `image`。
- 可选缩略图字段 `previews`（可重复）；兼容单值 `preview`，详见下文「缩略图」。
- 先建主题再传图：`POST /api/topics` 只接受 JSON，不要在同一次请求里混传文件。
- 限制：单张原图 ≤ 1 MiB，单个主题最多 3 张，`position` 由服务端按现有最大值递增。
- 请求体总大小（原图 + 缩略图合计）超过服务端上限 `MAX_UPLOAD_BODY_BYTES` 直接 413。

成功返回 201：

```json
{ "images": [ /* PostImage[] */ ] }
```

### 读取 `GET /media/posts/:id`

公开端点，返回原始字节，带 `ETag` 与长缓存头（`Cache-Control: public, max-age=31536000, immutable`），
`Content-Disposition: inline`。图片客户端可直接使用 Coil/Glide 并复用 HTTP 缓存。

查询参数 `size=preview` 请求缩略图。缩略图不存在时**回退原图**，因此该 URL 始终可渲染；
两种表示的 `ETag` 不同（缩略图带 `post-image-preview-` 前缀），不会互相污染缓存。

### 缩略图（preview）

**服务端不生成缩略图。** Workers 运行时没有可用的图片编解码器：Image Resizing 需要付费且
依赖已启用的 Zone，纯 JS/WASM 解码会超出免费层的 CPU 预算。因此缩略图由**客户端生成并随
上传一并提交**，服务端只做校验、存储与分发。

仓库自带的发帖表单已经实现了这一步：`public/js/image-preview.js` 在提交前用 canvas 生成
边长 480px、上限 64 KiB 的缩略图，并写入与 `images` 同序的 `previews` 字段，因此 Web 端
上传的图片同样带缩略图。其他客户端（含安卓）需要自行实现同等逻辑；不实现也不影响功能，
只是列表页会加载原图。

| 项 | 值 |
|---|---|
| 单张上限 | 256 KiB |
| 字段名 | `previews`（可重复），兼容 `preview` |
| 配对规则 | 与 `images` **按索引一一对应**，两者数量必须相等 |
| 校验 | 与原图共用同一套魔数与尺寸校验，仅字节上限与错误文案不同 |
| 可选性 | 完全可选；不提交时 `hasPreview` 为 `false`，读取端点回退原图 |

数量不一致时返回 422，且**不写入任何图片**——否则缩略图会被错配到别的图片上。

列表页每个主题最多只需要一张缩略图，所以客户端渲染 `GET /api/topics` 时可按 `firstImageId`
取图、按 `imageCount` 决定是否显示「+N」角标，并且只在 `hasPreview` 为 true 时才带
`size=preview`；否则直接用原图，避免为探测缩略图多发一次请求。

### 删除 `DELETE /api/images/:id`

成功返回 204，无响应体。作者、管理员或论坛主可调用。剩余图片的 `position` 会被服务端压缩，不留空洞。

### 状态码

上传与删除共用下列状态码，两者都不返回 400——id 非法与资源不存在一律走 404。

| 状态 | 场景 |
|---|---|
| 401 | 未登录 |
| 403 | 非作者、非管理员且非论坛主 |
| 404 | 主题或图片不存在（id 非法也走 404） |
| 409 | 该主题图片数量已达上限 |
| 413 | 请求体过大 |
| 422 | 图片未通过校验（格式魔数、尺寸），或 `previews` 与 `images` 数量不一致 |
| 429 | 触发限流，**响应体是纯文本** |

---

## 6. 契约的验证方式

本文件描述的行为由测试锁住，不靠人工维护：

- `test/contract/topic-image-contract.ts` 定义了一组与存储实现无关的图片字段断言；
- `test/repository.memory.test.ts` 与 `test/repository.d1.test.ts` 用**同一组断言**分别驱动内存实现和
  真实的 Miniflare + SQLite（含完整 migrations）；
- 因此 `imageCount` / `firstImageId` 的两种来源（D1 的 `TOPIC_SELECT` 相关子查询、内存的
  `topicImageSummary`）必须给出一致结果。
- `test/api-previews.test.ts` 锁住缩略图行为：`previews` 与 `images` 的索引配对、数量不一致时拒绝
  且不落库、256 KiB 上限、`?size=preview` 缺图时回退原图、两种表示 ETag 不同，以及删除图片 /
  主题后不残留孤儿缩略图。
- `test/api-images.test.ts` 锁住图片上传与删除的 HTTP 契约。

运行方式：

```bash
npx vitest run            # 全量
npm run test:contract     # 仅内存 / D1 契约一致性
npx tsc --noEmit          # 类型检查
```

### 漂移检测

建议客户端仓库 **vendor 一份本文件**并标注来源 commit，这样接口变动可以通过 diff 发现，
而不是等线上出问题。服务端改动本文件描述的行为时，应当同步更新这里的说明与契约测试。
