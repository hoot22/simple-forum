import type { Notification, NotificationKind, Page, UnreadCounts, User } from '../types'
import { Layout } from './layout'
import { Pagination, type PaginationLinks } from './pagination'
import { formatTime } from '../utils/time'

/** 两个标签的定义与顺序（顺序即页面上的展示顺序） */
const TABS: { kind: NotificationKind; label: string; href: string }[] = [
  { kind: 'notification', label: '通知', href: '/notifications' },
  { kind: 'announcement', label: '公告', href: '/notifications?tab=announcements' },
]

/**
 * 通知与公告页。
 *
 * 已读状态由路由层在渲染前写回存储，因此这里展示的是「本次访问时」的未读角标，
 * 而传给 Layout 的 unreadTotal 是标记已读之后仍然未读的数量（本次访问的标签已排除）。
 */
export function NotificationsPage(props: {
  currentUser: User
  csrf: string
  tab: NotificationKind
  page: Page<Notification>
  /** 本次访问时的未读数量，用于标签角标 */
  counts: UnreadCounts
  /** 标记已读之后仍未读的总数，用于导航红点 */
  unreadTotal: number
  /** 论坛主 / 管理员：在公告标签页显示发布表单 */
  canPostAnnouncement?: boolean
  /** 发布公告失败时的错误说明 */
  announceErrors?: string[]
  /** 发布失败时回填的已填内容 */
  announceValues?: { title: string; body: string }
  links: PaginationLinks
}) {
  const emptyText = props.tab === 'notification' ? '暂时没有通知。' : '暂时没有公告。'
  return (
    <Layout
      title="通知与公告 - Simple Forum"
      user={props.currentUser}
      csrf={props.csrf}
      activeNav="notifications"
      unreadNotifications={props.unreadTotal}
    >
      <div class="card">
        <h1>通知与公告</h1>

        <nav class="tabs" aria-label="通知与公告分类">
          {TABS.map((tab) => {
            const active = tab.kind === props.tab
            const unread =
              tab.kind === 'notification' ? props.counts.notifications : props.counts.announcements
            return (
              <a
                class={active ? 'tab is-active' : 'tab'}
                href={tab.href}
                aria-current={active ? 'page' : 'false'}
              >
                {tab.label}
                {unread > 0 ? <span class="tab-badge">{unread}</span> : null}
              </a>
            )
          })}
        </nav>

        {props.tab === 'announcement' && props.canPostAnnouncement ? (
          <section class="announce-compose">
            <h2 class="section-title">发布公告</h2>
            {props.announceErrors && props.announceErrors.length > 0 ? (
              <div class="alert alert-error">
                {props.announceErrors.map((error) => (
                  <div>{error}</div>
                ))}
              </div>
            ) : null}
            <form method="post" action="/notifications/announce" class="card">
              <input type="hidden" name="_csrf" value={props.csrf} />
              <div class="form-row">
                <input
                  type="text"
                  name="title"
                  maxlength={120}
                  placeholder="公告标题"
                  required
                  value={props.announceValues?.title ?? ''}
                />
              </div>
              <div class="form-row">
                <textarea name="body" placeholder="公告内容…" maxlength={5000} required>{props.announceValues?.body ?? ''}</textarea>
              </div>
              <div class="form-actions">
                <button class="btn btn-primary" type="submit">
                  发布公告
                </button>
              </div>
            </form>
          </section>
        ) : null}

        {props.page.items.length === 0 ? (
          <div class="empty">{emptyText}</div>
        ) : (
          <ul class="notice-list">
            {props.page.items.map((notice) => (
              <li class={notice.read ? 'notice' : 'notice is-unread'}>
                <div class="notice-head">
                  <span class="notice-title">
                    {notice.link ? <a href={notice.link}>{notice.title}</a> : notice.title}
                  </span>
                  <time class="notice-time" datetime={notice.createdAt}>
                    {formatTime(notice.createdAt)}
                  </time>
                </div>
                <p class="notice-text">{notice.body}</p>
              </li>
            ))}
          </ul>
        )}

        <Pagination links={props.links} />
      </div>
    </Layout>
  )
}
