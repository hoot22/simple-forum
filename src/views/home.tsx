import { postFontClass } from '../fonts/post-fonts'
import type { Topic, User } from '../types'
import { Layout } from './layout'
import { Pagination, type PaginationLinks } from './pagination'
import { excerpt, formatTime } from '../utils/time'

function AuthorLink(props: { topic: Topic }) {
  const t = props.topic
  if (t.authorId === null) {
    return <span>{t.author}</span>
  }
  return <a href={`/users/${t.authorId}`}>{t.author}</a>
}

/** 主题标记：置顶与公告；普通主题两者都不渲染 */
function TopicFlags(props: { topic: Topic }) {
  const t = props.topic
  if (!t.pinned && !t.isAnnouncement) return null
  return (
    <span class="topic-flags">
      {t.pinned ? <span class="badge badge-pinned">置顶</span> : null}
      {t.isAnnouncement ? <span class="badge badge-announcement">公告</span> : null}
    </span>
  )
}

/** 单条主题卡片：置顶区块与主列表复用同一份标记 */
function TopicCard(props: { topic: Topic }) {
  const t = props.topic
  return (
    <article class="card">
      <h2 class="topic-title">
        <TopicFlags topic={t} />
        <a href={`/topics/${t.id}`}>{t.title}</a>
      </h2>
      <div class="meta">
        <AuthorLink topic={t} />
        <span>·</span>
        <span>{t.replyCount} 回复</span>
        <span>·</span>
        <time datetime={t.createdAt}>{formatTime(t.createdAt)}</time>
      </div>
      <p class={`topic-excerpt ${postFontClass(t.font)}`}>{excerpt(t.content, 140)}</p>
    </article>
  )
}

export function HomePage(props: {
  topics: Topic[]
  /** 置顶主题：只在第一页由路由传入，单独展示在列表上方 */
  pinnedTopics?: Topic[]
  user: User | null
  csrf: string
  pagination: PaginationLinks
}) {
  const pinned = props.pinnedTopics ?? []
  return (
    <Layout
      title="Simple Forum"
      user={props.user}
      csrf={props.csrf}
      activeNav="home"
      showFooterLinks
    >
      <div class="toolbar">
        <h1>最新主题</h1>
        <a class="btn btn-primary" href="/topics/new">
          发新帖
        </a>
      </div>
      {pinned.length > 0 ? (
        <section class="pinned-section">
          <h2 class="section-title">置顶主题</h2>
          {pinned.map((t) => (
            <TopicCard topic={t} />
          ))}
        </section>
      ) : null}
      {props.topics.length === 0 ? (
        <div class="card empty">还没有主题，来发第一帖吧。</div>
      ) : (
        props.topics.map((t) => <TopicCard topic={t} />)
      )}
      <Pagination links={props.pagination} />
    </Layout>
  )
}
