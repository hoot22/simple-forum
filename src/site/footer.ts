/**
 * 页脚数据文件（联系方式 / 友情链接）
 *
 * 本文件只存放数据，渲染逻辑在 src/views/layout.tsx 的 SiteFooter，
 * 两者分开是为了让你以后增删条目时不必改动任何代码。
 *
 * ── 三种写法
 *   { label: 'QQ', value: '***********' }                    // 纯文本：QQ ********
 *   { label: '邮箱', value: 'you@example.com' }              // 纯文本：邮箱 you@example.com
 *   { label: 'GitHub', href: 'https://github.com/用户名' }   // 可点击链接
 *   { label: 'QQ', value: '*********', href: 'https://…' }  // 文本 + 可点击
 *
 * ── 规则
 *   · label 必填；value 与 href 至少填一个，否则该条会被忽略。
 *   · 只填 value：以「名称 + 内容」的纯文本显示，不生成链接。
 *   · 填了 href：整条渲染为链接；同时填 value 时，链接文字为「名称 + 内容」。
 *   · href 以 http/https 开头时在新标签页打开，其它协议（如 mailto:）在当前页跳转。
 *   · 数组留空时，对应那一栏整体不显示，站点名仍然居中。
 */

export interface FooterLink {
  /** 名称，例如「QQ」「邮箱」「GitHub」 */
  label: string
  /** 纯文本内容，例如 QQ 号或邮箱地址 */
  value?: string
  /** 链接地址；填了它整条才可点击 */
  href?: string
}

/** 联系方式：显示在页脚左侧 */
export const CONTACT_LINKS: FooterLink[] = [
  /**{ label: '平台', value: '你的账号' } */
]

/** 友情链接：显示在页脚右侧 */
export const FRIEND_LINKS: FooterLink[] = [
  /**{ label: '网站名称', href: '链接' } */
]

/** 以 http/https 开头的链接在新标签页打开，其它协议保持当前页 */
export function isExternalLink(href: string): boolean {
  return /^https?:\/\//i.test(href)
}

/**
 * 去掉两端空白并剔除无效条目，
 * 避免页脚出现空链接、空文字或只填了一半的条目。
 */
export function normalizeFooterLinks(links: readonly FooterLink[]): FooterLink[] {
  const out: FooterLink[] = []
  for (const link of links) {
    const label = link.label.trim()
    const value = link.value?.trim()
    const href = link.href?.trim()
    // 名称必填，且名称与内容至少有一个，否则整条丢弃
    if (label === '' || (!value && !href)) continue
    const item: FooterLink = { label }
    if (value) item.value = value
    if (href) item.href = href
    out.push(item)
  }
  return out
}
