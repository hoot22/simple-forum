import type { Topic, User } from '../types'
import { Layout } from './layout'

/**
 * 删除主题确认页（无 JavaScript 依赖）。
 * GET /topics/:id/delete 展示确认信息，表单 POST 到同一路径真正执行删除。
 */
export function ConfirmDeletePage(props: { topic: Topic; user: User | null; csrf: string }) {
  const t = props.topic
  return (
    <Layout title={`删除帖子 - ${t.title} - Simple Forum`} user={props.user} csrf={props.csrf}>
      <div class="toolbar">
        <h1 class="topic-title">删除帖子</h1>
        <a class="btn btn-ghost" href={`/topics/${t.id}`}>
          返回帖子
        </a>
      </div>
      <div class="card">
        <p>确认删除帖子「{t.title}」？此操作不可恢复。</p>
        {t.replyCount > 0 ? (
          <p class="meta">该帖子的 {t.replyCount} 条回复会一并删除。</p>
        ) : (
          <p class="meta">该帖子还没有回复。</p>
        )}
        <div class="form-actions">
          <form method="post" action={`/topics/${t.id}/delete`}>
            <input type="hidden" name="_csrf" value={props.csrf} />
            <button class="btn btn-danger" type="submit">
              确认删除
            </button>
          </form>
          <a class="btn btn-ghost" href={`/topics/${t.id}`}>
            取消
          </a>
        </div>
      </div>
    </Layout>
  )
}
