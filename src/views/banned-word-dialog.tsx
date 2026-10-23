import type { BannedWordMatch } from '../moderation/word-filter'
import { fieldLabel } from '../moderation/word-filter'

/**
 * 违禁词弹窗：提交内容命中词库时，服务端返回 400 并渲染本组件。
 *
 * 发帖与回帖共用同一套结构，只有顶部提示文案不同。
 * 无 JavaScript 时 <dialog open> 会退化成文档流内的卡片，提示依然可见且不遮挡表单。
 */
export function BannedWordDialog(props: {
  bannedWords: BannedWordMatch[]
  /** 顶部提示，用来说明被拒绝的具体操作。 */
  message: string
}) {
  if (props.bannedWords.length === 0) return null
  return (
    <div class="banned-word-block">
      <div class="alert alert-error">{props.message}</div>
      <dialog class="modal" open>
        <form method="dialog">
          <h2 class="modal-title">检测到违禁词</h2>
          <p class="modal-text">
            以下内容不允许发布，内容尚未提交。请修改后重新提交：
          </p>
          <ul class="modal-list">
            {props.bannedWords.map((match) => (
              <li>
                <span class="modal-field">{fieldLabel(match.field)}</span>
                <span class="modal-word">{match.word}</span>
              </li>
            ))}
          </ul>
          <div class="modal-actions">
            <button class="btn btn-primary" type="submit" data-dialog-close>
              返回修改
            </button>
          </div>
        </form>
      </dialog>
      <script src="/js/banned-word-dialog.js" defer></script>
    </div>
  )
}
