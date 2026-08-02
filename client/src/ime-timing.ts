// S-09: 変換候補取得(ネットワーク lookup)の所要時間を毎回記録するデバッグ計測。
// S-08(ローカルフォールバック変換)のしきい値を実データで決めるための計測ログ。
// 端末にファイルシステムは無いので localStorage のリングバッファに残し、
// window.__imeTimingLog / window.__dumpImeTiming() で吸い出せるようにする。

export interface ImeTimingEntry {
  /** 変換対象の読み(かな) */
  reading: string
  /** lookup にかかった時間(ms, 小数1桁) */
  ms: number
  /** 取得成功なら true、ネットワーク等で失敗なら false */
  ok: boolean
  /** 記録時刻(epoch ms) */
  ts: number
}

const STORAGE_KEY = 'even-scribe.ime-timing'
const LIMIT = 200

type TimingWindow = typeof window & {
  __imeTimingLog?: ImeTimingEntry[]
  __dumpImeTiming?: () => string
}

function load(): ImeTimingEntry[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (e): e is ImeTimingEntry =>
        !!e && typeof e === 'object' && typeof (e as ImeTimingEntry).reading === 'string' && typeof (e as ImeTimingEntry).ms === 'number',
    )
  } catch {
    return []
  }
}

const log: ImeTimingEntry[] = load()

/** p50 / p95 / max などの要約を返す(しきい値検討用)。 */
export function summarizeImeTiming(entries: ImeTimingEntry[] = log): {
  count: number
  ok: number
  fail: number
  p50: number
  p95: number
  max: number
} {
  const oks = entries.filter(e => e.ok).map(e => e.ms).sort((a, b) => a - b)
  const pct = (p: number): number => (oks.length === 0 ? 0 : oks[Math.min(oks.length - 1, Math.floor((p / 100) * oks.length))])
  return {
    count: entries.length,
    ok: oks.length,
    fail: entries.filter(e => !e.ok).length,
    p50: pct(50),
    p95: pct(95),
    max: oks.length === 0 ? 0 : oks[oks.length - 1],
  }
}

function persist(): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(log))
  } catch {
    // localStorage が使えない/容量超過でも計測本体は続行する(メモリ上には残る)。
  }
}

/** 1 回の変換 lookup の所要時間を記録する。runImeLookup から呼ぶ。 */
export function recordImeTiming(reading: string, ms: number, ok: boolean): void {
  log.push({ reading, ms: Math.round(ms * 10) / 10, ok, ts: Date.now() })
  if (log.length > LIMIT) log.splice(0, log.length - LIMIT)
  persist()
  const w = window as TimingWindow
  w.__imeTimingLog = log
  w.__dumpImeTiming = () => JSON.stringify({ summary: summarizeImeTiming(), entries: log }, null, 2)
}

/** 記録をすべて消す(デバッグ用)。 */
export function clearImeTiming(): void {
  log.length = 0
  persist()
}

// 起動時点で window に露出しておく(まだ 1 件も無くても吸い出せるように)。
{
  const w = window as TimingWindow
  w.__imeTimingLog = log
  w.__dumpImeTiming = () => JSON.stringify({ summary: summarizeImeTiming(), entries: log }, null, 2)
}
