// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// ime-timing はモジュール読み込み時に localStorage から復元し、以後の記録を
// 追記する。テスト間で状態が混ざらないよう、毎回 localStorage を消して
// モジュールを import しなおす(vi.resetModules)。
async function freshModule() {
  window.localStorage.clear()
  const vitest = await import('vitest')
  vitest.vi.resetModules()
  return import('../src/ime-timing')
}

describe('ime-timing (S-09 conversion latency log)', () => {
  beforeEach(() => window.localStorage.clear())
  afterEach(() => window.localStorage.clear())

  it('records each lookup with reading/ms/ok and exposes it on window', async () => {
    const { recordImeTiming } = await freshModule()
    recordImeTiming('きょう', 123.45, true)
    recordImeTiming('あした', 50, false)

    const log = (window as unknown as { __imeTimingLog: Array<{ reading: string; ms: number; ok: boolean; ts: number }> }).__imeTimingLog
    expect(log).toHaveLength(2)
    expect(log[0]).toMatchObject({ reading: 'きょう', ms: 123.5, ok: true })
    expect(log[1]).toMatchObject({ reading: 'あした', ms: 50, ok: false })
    expect(typeof log[0].ts).toBe('number')
  })

  it('persists to localStorage and reloads on next module init', async () => {
    const first = await freshModule()
    first.recordImeTiming('きょう', 100, true)
    expect(window.localStorage.getItem('even-scribe.ime-timing')).toContain('きょう')

    // localStorage を残したまま再 import すると復元される
    const vitest = await import('vitest')
    vitest.vi.resetModules()
    const second = await import('../src/ime-timing')
    const log = (window as unknown as { __imeTimingLog: Array<{ reading: string }> }).__imeTimingLog
    expect(log.map(e => e.reading)).toContain('きょう')
    expect(second.summarizeImeTiming().count).toBe(1)
  })

  it('caps the ring buffer at 200 entries', async () => {
    const { recordImeTiming, summarizeImeTiming } = await freshModule()
    for (let i = 0; i < 250; i++) recordImeTiming(`r${i}`, i, true)
    expect(summarizeImeTiming().count).toBe(200)
  })

  it('summarizes p50/p95/max over successful lookups only', async () => {
    const { recordImeTiming, summarizeImeTiming } = await freshModule()
    for (const ms of [10, 20, 30, 40, 1000]) recordImeTiming('x', ms, true)
    recordImeTiming('x', 9999, false) // 失敗は要約の分位から除外
    const s = summarizeImeTiming()
    expect(s.count).toBe(6)
    expect(s.ok).toBe(5)
    expect(s.fail).toBe(1)
    expect(s.max).toBe(1000)
    expect(s.p50).toBeGreaterThanOrEqual(20)
    expect(s.p50).toBeLessThanOrEqual(40)
  })

  it('dumps a JSON string with summary and entries', async () => {
    const { recordImeTiming } = await freshModule()
    recordImeTiming('きょう', 42, true)
    const dump = (window as unknown as { __dumpImeTiming: () => string }).__dumpImeTiming()
    const parsed = JSON.parse(dump) as { summary: { count: number }; entries: Array<{ reading: string }> }
    expect(parsed.summary.count).toBe(1)
    expect(parsed.entries[0].reading).toBe('きょう')
  })
})
