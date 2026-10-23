import { describe, expect, it } from 'vitest'

import { formatTime } from '../src/utils/time'

/**
 * formatTime 只负责显示层：把库里的 UTC 时间换算成北京时间（UTC+8）。
 *
 * 需要覆盖的两点：
 * 1. 存储有两种格式，D1/SQLite 的 "YYYY-MM-DD HH:MM:SS" 和内存的 ISO 8601。
 * 2. 换算必须跨日、跨月、跨年都正确，且补零稳定。
 */
describe('formatTime 北京时间', () => {
  it('把 SQLite 的 UTC 字符串换算为北京时间', () => {
    expect(formatTime('2026-09-06 08:30:00')).toBe('2026-09-06 16:30')
  })

  it('把 ISO 8601 的 UTC 字符串换算为北京时间', () => {
    expect(formatTime('2026-09-06T08:30:00.000Z')).toBe('2026-09-06 16:30')
  })

  it('两种存储格式对同一时刻给出一致结果', () => {
    expect(formatTime('2026-09-06 08:30:00')).toBe(
      formatTime('2026-09-06T08:30:00.000Z'),
    )
  })

  it('换算后跨日时日期一并进位', () => {
    expect(formatTime('2026-09-06 20:00:00')).toBe('2026-09-07 04:00')
  })

  it('换算后跨月时日期一并进位', () => {
    expect(formatTime('2026-09-30 17:30:00')).toBe('2026-10-01 01:30')
  })

  it('换算后跨年时日期一并进位', () => {
    expect(formatTime('2025-12-31 17:00:00')).toBe('2026-01-01 01:00')
  })

  it('个位数的月、日、时、分都补零', () => {
    expect(formatTime('2026-01-05 01:05:00')).toBe('2026-01-05 09:05')
  })

  it('UTC 当日 00:00 对应北京时间当天 08:00', () => {
    expect(formatTime('2026-03-01 00:00:00')).toBe('2026-03-01 08:00')
  })

  it('无法解析的输入原样返回，不抛错', () => {
    expect(formatTime('not-a-time')).toBe('not-a-time')
    expect(formatTime('')).toBe('')
  })

  it('输出格式固定，便于在列表中对齐', () => {
    expect(formatTime('2026-09-06T08:30:00.000Z')).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/,
    )
  })
})
