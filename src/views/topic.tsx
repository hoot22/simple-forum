import { postFontClass } from '../fonts/post-fonts'
import type { Reply, ReplyTarget, TopicDetail, User } from '../types'
import type { BannedWordMatch } from '../moderation/word-filter'
import { BannedWordDialog } from './banned-word-dialog'
import { Layout } from './layout'
import { Pagination, type PaginationLinks } from './pagination'
import { formatTime } from '../utils/time'

function AuthorLine(props: { authorId: number | null; author: string; createdAt: string }) {
  return (
    <div class="meta">
      {props.authorId === null ? (
        <span>{props.author}</span>
      ) : (
        <a href={`/users/${props.authorId}`}>{props.author}</a>
      )}
      <span>·</span>
      <time datetime={props.createdAt}>{formatTime(props.createdAt)}</time>
    </div>
  )
}

function ReplyForm(props: {
  topicId: number
  replyErrors: string[]
  replyContent: string
  /** 命中的违禁词；非空表示回复已被拒绝，页面会弹出说明。 */
  bannedWords?: BannedWordMatch[]
  /** 当前正在回复的评论；为空时是普通回帖 */
  replyTarget?: ReplyTarget | null
  csrf: string
}) {
  const target = props.replyTarget ?? null
  return (
    <>
      <h2 class="section-title">发表回复</h2>
      <BannedWordDialog
        bannedWords={props.bannedWords ?? []}
        message="回复未发布：正文包含违禁词，请修改后重新提交。"
      />
      {props.replyErrors.length > 0 ? (
        <div class="alert alert-error">
          {props.replyErrors.map((error) => (
            <div>{error}</div>
          ))}
        </div>
      ) : null}
      <form method="post" action={`/topics/${props.topicId}/reply`} class="card" id="reply-form">
        <input type="hidden" name="_csrf" value={props.csrf} />
        {target ? <input type="hidden" name="parentReplyId" value={String(target.id)} /> : null}
        {target ? (
          <div class="reply-compose-target">
            <span>
              正在回复 <strong>@{target.author}</strong>
            </span>
            <a href={`/topics/${props.topicId}#reply-form`}>取消</a>
          </div>
        ) : null}
        <div class="form-row">
          <textarea name="content" placeholder="写下你的回复…" required>{props.replyContent}</textarea>
        </div>
        <div class="form-actions">
          <button class="btn btn-primary" type="submit">
            回复
          </button>
        </div>
      </form>
    </>
  )
}

/**
 * 把当前页的回复按父子关系分组。
 *
 * 只缩进一级：更深层级的回复归入同一个根楼层，靠「回复 @某人」标注对象，避免小屏上层层缩进。
 * 父回复不在本页时（被翻页隔开），该回复按根楼层展示，保证任何一条回复都不会凭空消失。
 */
function buildThreads(replies: Reply[]): { root: Reply; children: Reply[] }[] {
  const threads: { root: Reply; children: Reply[] }[] = []
  const threadOf = new Map<number, { root: Reply; children: Reply[] }>()

  for (const reply of replies) {
    const parentId = reply.parentReplyId ?? null
    const thread = parentId === null ? undefined : threadOf.get(parentId)
    if (thread === undefined) {
      const created = { root: reply, children: [] }
      threads.push(created)
      threadOf.set(reply.id, created)
      continue
    }
    thread.children.push(reply)
    threadOf.set(reply.id, thread)
  }

  return threads
}

/** 单条回复；user 为 null（未登录）时不渲染「回复」入口。 */
function ReplyBody(props: {
  reply: Reply
  user: User | null
  topicId: number
  /** 是否标注「回复 @某人」：只在其直接父回复不是所在根楼层时才需要 */
  showTarget?: boolean
}) {
  const r = props.reply
  return (
    <div class="reply-item" id={`reply-${r.id}`}>
      <AuthorLine authorId={r.authorId} author={r.author} createdAt={r.createdAt} />
      {props.showTarget && r.parentAuthor ? (
        <p class="reply-target">
          回复 <span class="reply-target-name">@{r.parentAuthor}</span>
        </p>
      ) : null}
      <p class="reply-body">{r.content}</p>
      {props.user ? (
        <p class="reply-actions">
          <a href={`/topics/${props.topicId}?replyTo=${r.id}#reply-form`}>回复</a>
        </p>
      ) : null}
    </div>
  )
}

export function TopicPage(props: {
  topic: TopicDetail
  user: User | null
  replyErrors: string[]
  replyContent: string
  /** 命中的违禁词；非空表示回复已被拒绝，转发给回复表单弹窗。 */
  bannedWords?: BannedWordMatch[]
  csrf: string
  canDelete: boolean
  /** 论坛主 / 管理员：可置顶主题、设为公告 */
  canManage?: boolean
  repliesPagination: PaginationLinks
  /** 当前正在回复的评论（?replyTo=）；为空时是普通回帖 */
  replyTarget?: ReplyTarget | null
}) {
  const t = props.topic
  // 存储层的回复页是「从新到旧」，当前页反转后按时间正序展示，符合对话阅读习惯
  const replies = [...t.replies.items].reverse()
  return (
    <Layout title={`${t.title} - Simple Forum`} user={props.user} csrf={props.csrf}>
      <div class="toolbar">
        <h1 class="topic-title">
          {t.pinned ? <span class="badge badge-pinned">置顶</span> : null}
          {t.isAnnouncement ? <span class="badge badge-announcement">公告</span> : null}
          {t.title}
        </h1>
        <div class="toolbar-actions">
          {props.canDelete ? (
            <a class="btn btn-danger-ghost btn-sm" href={`/topics/${t.id}/delete`}>
              删除帖子
            </a>
          ) : null}
          <a class="btn btn-ghost" href="/">
            返回首页
          </a>
        </div>
      </div>
      {props.canManage ? (
        <div class="toolbar toolbar-manage">
          <form method="post" action={`/topics/${t.id}/pin`}>
            <input type="hidden" name="_csrf" value={props.csrf} />
            <input type="hidden" name="value" value={t.pinned ? '0' : '1'} />
            <button class="btn btn-ghost btn-sm" type="submit">
              {t.pinned ? '取消置顶' : '置顶主题'}
            </button>
          </form>
          <form method="post" action={`/topics/${t.id}/announce`}>
            <input type="hidden" name="_csrf" value={props.csrf} />
            <input type="hidden" name="value" value={t.isAnnouncement ? '0' : '1'} />
            <button class="btn btn-ghost btn-sm" type="submit">
              {t.isAnnouncement ? '取消公告' : '设为公告'}
            </button>
          </form>
        </div>
      ) : null}
      <article class="card">
        <AuthorLine authorId={t.authorId} author={t.author} createdAt={t.createdAt} />
        <p class={`post-content ${postFontClass(t.font)}`}>{t.content}</p>
        {t.images && t.images.length > 0 ? (
          <div class="post-images">
            {t.images.map((image) => (
              <img
                src={`/media/posts/${image.id}`}
                alt=""
                loading="lazy"
                decoding="async"
                class="post-image"
              />
            ))}
          </div>
        ) : null}
      </article>

      <h2 class="section-title">全部回复（{t.replyCount}）</h2>
      <div class="card reply-list">
        {t.replyCount === 0 ? (
          <div class="empty">还没有回复，抢个沙发？</div>
        ) : replies.length === 0 ? (
          <div class="empty">这一页没有回复，试试「较新回复」。</div>
        ) : (
          buildThreads(replies).map((thread) => (
            <div class="reply-thread">
              <ReplyBody
                reply={thread.root}
                user={props.user}
                topicId={t.id}
                showTarget={thread.root.parentReplyId != null}
              />
              {thread.children.length > 0 ? (
                <div class="reply-children">
                  {thread.children.map((child) => (
                    <ReplyBody
                      reply={child}
                      user={props.user}
                      topicId={t.id}
                      showTarget={child.parentReplyId !== thread.root.id}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>
      <Pagination links={props.repliesPagination} newerLabel="较新回复" olderLabel="较早回复" />

      {props.user ? (
        <ReplyForm
          topicId={t.id}
          replyErrors={props.replyErrors}
          replyContent={props.replyContent}
          bannedWords={props.bannedWords}
          replyTarget={props.replyTarget}
          csrf={props.csrf}
        />
      ) : (
        <div class="alert alert-info">
          登录后即可参与回复：<a href="/login">登录</a> · <a href="/register">注册</a>
        </div>
      )}
    </Layout>
  )
}
