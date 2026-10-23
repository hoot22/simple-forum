/**
 * Cloudflare Worker Bindings。
 *
 * - DB：可选字段。未配置 D1 时为 undefined（走内存存储），
 *   在 wrangler.jsonc 启用 d1_databases 后由运行时注入（自动切到 D1）。
 * - SESSION_SECRET：签名登录 Cookie 的密钥。本地内存模式可缺省（有内置开发密钥），
 *   一旦启用 D1 部署到 Cloudflare，必须通过 `wrangler secret put SESSION_SECRET` 设置，
 *   否则应用启动会直接报错（fail-closed，避免线上用弱密钥签名会话）。
 */
export interface Env {
  DB?: D1Database
  /**
   * 帖子图片直接以 BLOB 存放在 D1 的 post_images 表中，
   * 因此本项目不再需要 R2 或任何对象存储绑定。
   */
  SESSION_SECRET?: string
  /** 轮换过渡期使用的上一个会话密钥；只用于校验旧会话，不再签发新令牌 */
  SESSION_SECRET_PREVIOUS?: string
  /**
   * 运行环境标记。设为 "production" 时启用生产强校验：
   * 必须绑定 D1 数据库，且 SESSION_SECRET 达到最小长度。
   */
  ENVIRONMENT?: string
}
