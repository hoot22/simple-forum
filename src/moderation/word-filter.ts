import { BANNED_WORDS } from './banned-words'

/** 单次报错最多列出的词条数，避免弹窗过长。 */
export const MAX_REPORTED_WORDS = 5

/** 参与检测的字段。 */
export const CHECKED_FIELDS = ['title', 'content'] as const

export type CheckedField = (typeof CHECKED_FIELDS)[number]

export interface BannedWordMatch {
  field: CheckedField
  /** 命中的词条原文（取自词库，便于用户对照修改）。 */
  word: string
}

/**
 * 违禁词过滤器。
 *
 * 做成工厂是为了让词库可注入：默认实例读取 src/moderation/banned-words.ts，
 * 测试则可以传入自定义词条，无需改动随附词库。
 */
export interface WordFilter {
  /** 实际生效的词条数量（已剔除空词条与重复项）。 */
  count(): number
  /** 扫描单段文本，返回命中的词条原文；空数组表示未命中。 */
  scanText(text: string, limit?: number): string[]
  /** 检查标题与正文；空数组表示可以发布。 */
  check(fields: Partial<Record<CheckedField, string>>): BannedWordMatch[]
}

/**
 * 归一化：仅用于比对，不会改动用户实际提交或入库的内容。
 *
 * - NFKC 把全角字母、数字、标点折叠为半角（'ｓｐａｍ' → 'spam'）
 * - 转小写，使拉丁字母不区分大小写
 * - 去掉全部空白、标点与符号，使 '违 禁-词' 与 '违禁词' 等价
 */
export function normalizeForCheck(input: string): string {
  return input.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
}

interface CompiledWord {
  /** 词条原文，用于回显。 */
  display: string
  /** 归一化后的匹配形式。 */
  normalized: string
}

/**
 * 预处理词库：丢弃空词条与重复项，并缓存匹配用形式。
 * 每个过滤器只执行一次，请求期是纯线性字符串扫描。
 */
function compileWords(words: readonly string[]): CompiledWord[] {
  const seen = new Set<string>()
  const compiled: CompiledWord[] = []
  for (const raw of words) {
    if (typeof raw !== 'string') continue
    const display = raw.trim()
    if (display.length === 0) continue
    const normalized = normalizeForCheck(display)
    // 词条可能只由标点组成，归一化后为空，这类词条无法用于匹配。
    if (normalized.length === 0) continue
    if (seen.has(normalized)) continue
    seen.add(normalized)
    compiled.push({ display, normalized })
  }
  return compiled
}

export function createWordFilter(words: readonly string[]): WordFilter {
  const compiled = compileWords(words)

  function scanText(text: string, limit: number = MAX_REPORTED_WORDS): string[] {
    if (compiled.length === 0 || text.length === 0) return []
    const haystack = normalizeForCheck(text)
    if (haystack.length === 0) return []
    const hits: string[] = []
    for (const entry of compiled) {
      if (haystack.includes(entry.normalized)) {
        hits.push(entry.display)
        if (hits.length >= limit) break
      }
    }
    return hits
  }

  return {
    count: () => compiled.length,
    scanText,
    check(fields) {
      const matches: BannedWordMatch[] = []
      for (const field of CHECKED_FIELDS) {
        const value = fields[field]
        if (typeof value !== 'string' || value.length === 0) continue
        for (const word of scanText(value)) {
          matches.push({ field, word })
        }
      }
      return matches
    },
  }
}

/** 默认词库（src/moderation/banned-words.ts）对应的过滤器。 */
export const defaultWordFilter: WordFilter = createWordFilter(BANNED_WORDS)

/** 实际生效的词条数量，便于自检与测试。 */
export function bannedWordCount(): number {
  return defaultWordFilter.count()
}

/** 使用默认词库扫描单段文本。 */
export function scanTextForBannedWords(text: string, limit?: number): string[] {
  return defaultWordFilter.scanText(text, limit)
}

/** 使用默认词库检查标题与正文。 */
export function checkForBannedWords(
  fields: Partial<Record<CheckedField, string>>,
): BannedWordMatch[] {
  return defaultWordFilter.check(fields)
}

/** 字段的中文名称，用于提示文案。 */
export function fieldLabel(field: CheckedField): string {
  return field === 'title' ? '标题' : '正文'
}
