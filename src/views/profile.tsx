import { postFontClass } from '../fonts/post-fonts'
import type { UserStats } from '../db/store'
import type { Page, ReplyWithTopic, Topic, User } from '../types'
import { Layout } from './layout'
import { excerpt, formatTime } from '../utils/time'

export function ProfilePage(props: {
  profile: User
  isSelf: boolean
  currentUser: User | null
  ownerId: number | null
  canManageAdmins: boolean
  stats: UserStats
  topics: Page<Topic>
  replies: Page<ReplyWithTopic>
  csrf: string
}) {
  const p = props.profile
  const topics = props.topics.items
  const replies = props.replies.items
  const isOwnerProfile = props.ownerId !== null && p.id === props.ownerId
  /* 最近主题与最近回复在个人页各只预览前 4 条，其余折叠进「展开更多」。 */
  const previewLimit = 4
  const hiddenTopics = topics.slice(previewLimit)
  const hiddenReplies = replies.slice(previewLimit)

  const renderTopic = (t: Topic) => (
    <article class="card">
      <h2 class="topic-title">
        <a href={`/topics/${t.id}`}>{t.title}</a>
      </h2>
      <div class="meta">
        <span>{t.replyCount} 回复</span>
        <span>·</span>
        <time datetime={t.createdAt}>{formatTime(t.createdAt)}</time>
      </div>
      <p class={`topic-excerpt ${postFontClass(t.font)}`}>{excerpt(t.content, 120)}</p>
    </article>
  )

  const renderReply = (row: ReplyWithTopic) => (
    <div class="reply-item">
      <p class="reply-item-title">
        <a href={`/topics/${row.topicId}`}>回复：{row.topicTitle ?? '（主题已删除）'}</a>
      </p>
      <div class="meta">
        <time datetime={row.createdAt}>{formatTime(row.createdAt)}</time>
      </div>
      <p class="reply-body">{excerpt(row.content, 160)}</p>
    </div>
  )

  return (
    <Layout
      title={`${p.username} 的个人页 - Simple Forum`}
      user={props.currentUser}
      csrf={props.csrf}
      activeNav={props.isSelf ? 'profile' : undefined}
    >
      <div class="card profile-head">
        <div class="avatar">{(p.username[0] ?? '?').toUpperCase()}</div>
        <div>
          <h1 class="profile-name">
            {p.username}
            {isOwnerProfile ? <span class="badge-owner">论坛主</span> : null}
            {!isOwnerProfile && p.isAdmin ? <span class="badge-admin">管理员</span> : null}
            {props.isSelf ? <span class="badge-self">我的主页</span> : null}
          </h1>
          <p class="profile-meta">
            注册于 {formatTime(p.createdAt)}
          </p>
          {props.isSelf ? (
            <form class="inline-form" method="post" action="/logout">
              <input type="hidden" name="_csrf" value={props.csrf} />
              <button class="btn btn-ghost btn-sm" type="submit">
                退出登录
              </button>
            </form>
          ) : null}
          {props.canManageAdmins && !props.isSelf && !isOwnerProfile ? (
            <form class="inline-form" method="post" action={`/users/${p.id}/admin`}>
              <input type="hidden" name="_csrf" value={props.csrf} />
              {p.isAdmin ? (
                <button class="btn btn-ghost btn-sm" type="submit" name="isAdmin" value="0">
                  取消管理员
                </button>
              ) : (
                <button class="btn btn-ghost btn-sm" type="submit" name="isAdmin" value="1">
                  设为管理员
                </button>
              )}
            </form>
          ) : null}
        </div>
      </div>
      <div class="card stats">
        <div class="stat">
          <div class="stat-num">{props.stats.topicCount}</div>
          <div class="stat-label">主题</div>
        </div>
        <div class="stat">
          <div class="stat-num">{props.stats.replyCount}</div>
          <div class="stat-label">回复</div>
        </div>
      </div>

      <h2 class="section-title">主题</h2>
      {topics.length === 0 ? (
        <div class="card empty">还没有发过主题。</div>
      ) : (
        <>
          {topics.slice(0, previewLimit).map(renderTopic)}
          {hiddenTopics.length > 0 ? (
            <details class="collapse-more">
              <summary>展开更多主题（还有 {hiddenTopics.length} 条）</summary>
              <div class="collapse-more-body">{hiddenTopics.map(renderTopic)}</div>
            </details>
          ) : null}
        </>
      )}
      {props.topics.nextCursor ? <p class="meta">还有更多主题未显示。</p> : null}

      <h2 class="section-title">最近回复</h2>
      {replies.length === 0 ? (
        <div class="card empty">还没有回复过。</div>
      ) : (
        <div class="card reply-list">
          {replies.slice(0, previewLimit).map(renderReply)}
          {hiddenReplies.length > 0 ? (
            <details class="collapse-more">
              <summary>展开更多回复（还有 {hiddenReplies.length} 条）</summary>
              <div class="collapse-more-body">{hiddenReplies.map(renderReply)}</div>
            </details>
          ) : null}
        </div>
      )}
      {props.replies.nextCursor ? <p class="meta">还有更多回复未显示。</p> : null}
    </Layout>
  )
}
