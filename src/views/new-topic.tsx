import { POST_FONT_DEFAULT, POST_FONTS } from '../fonts/post-fonts'
import type { PostFontId, User } from '../types'
import type { BannedWordMatch } from '../moderation/word-filter'
import { BannedWordDialog } from './banned-word-dialog'
import { Layout } from './layout'

export interface TopicFormValues {
  title: string
  content: string
  font: PostFontId
}

export function NewTopicPage(props: {
  user: User
  errors: string[]
  values: Partial<TopicFormValues>
  csrf: string
  /** 命中的违禁词；非空表示帖子已被拒绝，页面会弹出说明。 */
  bannedWords?: BannedWordMatch[]
}) {
  return (
    <Layout title="发新帖 - Simple Forum" user={props.user} csrf={props.csrf}>
      <div class="toolbar">
        <h1>发新帖</h1>
        <a class="btn btn-ghost" href="/">返回首页</a>
      </div>
      {props.errors.length > 0 ? (
        <div class="alert alert-error">
          {props.errors.map((error) => (
            <div>{error}</div>
          ))}
        </div>
      ) : null}
      <BannedWordDialog
        bannedWords={props.bannedWords ?? []}
        message="帖子未发布：标题或正文包含违禁词，请修改后重新提交。"
      />
      <form method="post" action="/topics/new" class="card" enctype="multipart/form-data">
        <input type="hidden" name="_csrf" value={props.csrf} />
        <div class="form-row">
          <label for="images">图片（可选，最多 3 张，单张不超过 1 MiB）</label>
          <input
            id="images"
            name="images"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            multiple
          />
          <p class="form-hint">
            浏览器只会读取你主动选择的文件，不会扫描相册或设备目录。较大的图片会在提交前自动压缩，并生成列表页用的缩略图。
          </p>
          <p id="image-notice" class="image-notice" role="status"></p>
          <ul id="image-preview" class="image-preview" aria-live="polite"></ul>
        </div>
        <script src="/js/image-preview.js" defer></script>
        <script src="/js/textarea-autogrow.js" defer></script>
        <div class="form-row">
          <label>标题</label>
          <input type="text" name="title" value={props.values.title ?? ''} maxlength={120} placeholder="一句话说明主题" required />
        </div>
        <div class="form-row">
          <label>内容</label>
          <textarea name="content" data-autogrow placeholder="补充细节（可选）">{props.values.content ?? ''}</textarea>
        </div>
        <div class="form-row">
          <label>字体</label>
          <div class="font-options">
            {POST_FONTS.map((option) => (
              <label class="font-option">
                <input
                  type="radio"
                  name="font"
                  value={option.id}
                  data-font-radio
                  data-font-class={option.className}
                  checked={(props.values.font ?? POST_FONT_DEFAULT) === option.id}
                />
                <span>{option.label}</span>
                <span class="font-option-hint">{option.hint}</span>
              </label>
            ))}
          </div>
          <div class="font-preview-sample" data-font-preview>
            <span class="font-preview-label">预览：</span>
            这是一段示例文字，用于查看所选字体的效果。The quick brown fox 0123456789
          </div>
          <script src="/js/font-preview.js" defer></script>
          <script src="/js/font-availability.js" defer></script>
        </div>
        <div class="form-actions">
          <button class="btn btn-primary" type="submit">发布</button>
        </div>
      </form>
    </Layout>
  )
}
