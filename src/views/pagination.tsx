/**
 * 分页组件（服务端渲染）。
 * - 链接由路由层用 cursorHref 生成，传入 PaginationLinks；
 * - 所有链接都是普通 <a>，无 JavaScript 也能翻页；
 * - 「回到最新」只在带游标的页面上出现，避免用户迷失在深页。
 */

export interface PaginationLinks {
  /** 「较新」方向的链接；已在最新端时为 null */
  newerHref: string | null
  /** 「较早」方向的链接；已到末尾时为 null */
  olderHref: string | null
  /** 不带游标的第一页链接；不在分页状态时为 null */
  latestHref: string | null
}

/**
 * 生成分页链接：cursor 为空时返回 null（可直接作为 PaginationLinks 的成员）。
 * extra 用于透传其他查询参数（如排序方式），空值会被忽略。
 */
export function cursorHref(
  basePath: string,
  param: string,
  cursor: string | null,
  extra?: Record<string, string | undefined>,
): string | null {
  if (!cursor) return null
  const query = new URLSearchParams()
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      if (value !== undefined && value !== '') query.set(key, value)
    }
  }
  query.set(param, cursor)
  return `${basePath}?${query.toString()}`
}

export function Pagination(props: {
  links: PaginationLinks
  newerLabel?: string
  olderLabel?: string
}) {
  const { newerHref, olderHref, latestHref } = props.links
  if (!newerHref && !olderHref && !latestHref) return <></>
  return (
    <nav class="pagination" aria-label="分页导航">
      {newerHref ? (
        <a class="btn btn-ghost btn-sm" href={newerHref}>
          ← {props.newerLabel ?? '较新'}
        </a>
      ) : null}
      {olderHref ? (
        <a class="btn btn-ghost btn-sm" href={olderHref}>
          {props.olderLabel ?? '较早'} →
        </a>
      ) : null}
      {latestHref ? (
        <a class="btn btn-ghost btn-sm" href={latestHref}>
          回到最新
        </a>
      ) : null}
    </nav>
  )
}
