import type { PostFontId } from '../types'

/**
 * 发帖可选字体。
 *
 * 可用字体都是点阵（像素）字体，只有在其设计尺寸下才点对点清晰，
 * 所以 CSS 类除了 font-family 还固定 font-size 与 line-height。
 * 需要放大时请用设计尺寸的整数倍，否则点阵字会发虚。
 *
 * 数据与逻辑集中在这一份：新增字体只需在此处加一条，
 * 并把字体文件放进 public/fonts/（Pages 只部署 public/）。
 */
export interface PostFontOption {
  id: PostFontId
  /** 表单与预览里显示的名字 */
  label: string
  /** 挂在帖子正文上的 CSS 类 */
  className: string
  /** 表单里的一句话说明 */
  hint: string
  /** 字体文件在站点内的路径，用于文档与测试核对 */
  file: string
}

const DEFAULT_FONT_OPTION: PostFontOption = {
  id: 'default',
  label: '默认字体',
  className: 'post-font-default',
  hint: '跟随站点样式',
  file: '',
}

export const POST_FONT_DEFAULT: PostFontId = 'default'

export const POST_FONTS: readonly PostFontOption[] = [
  DEFAULT_FONT_OPTION,
  {
    id: 'wqy-bitmap-song',
    label: '文泉驿点阵宋',
    className: 'post-font-wqy',
    hint: '16px 点阵宋体，适合正文',
    file: 'WenQuanYi.Bitmap.Song.16px.ttf',
  },
]

const POST_FONT_IDS: readonly string[] = POST_FONTS.map((option) => option.id)

export function isPostFontId(value: unknown): value is PostFontId {
  return typeof value === 'string' && POST_FONT_IDS.includes(value)
}

/**
 * 把任意来源的值归一为合法字体标识。
 * 表单、接口与数据库都可能传来历史值或伪造值，一律回落到默认字体而不报错。
 */
export function toPostFontId(value: unknown): PostFontId {
  return isPostFontId(value) ? value : POST_FONT_DEFAULT
}

/** 帖子正文的 CSS 类。未知值按默认字体处理，避免渲染出未定义的类名。 */
export function postFontClass(font: unknown): string {
  const option = POST_FONTS.find((item) => item.id === font)
  return option ? option.className : DEFAULT_FONT_OPTION.className
}
