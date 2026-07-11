import { toKana } from 'wanakana'

export interface RomajiState {
  reading: string
  pending: string
}

// 外来音・記号の上書き（wanakana 既定を上書き）。記号の即時確定は ime.ts 側で扱うため
// ここでは reading 内に残す長音/外来音の補正のみを行う。
const CUSTOM_KANA_MAPPING: Record<string, string> = {
  di: 'でぃ',
  du: 'どぅ',
  '[': '「',
  ']': '」',
}
const IME_OPTS = { IMEMode: true as const, customKanaMapping: CUSTOM_KANA_MAPPING }

export function canStartComposition(char: string): boolean {
  if (char.length !== 1) return false
  return /^[a-z0-9]$/i.test(char) || char === '-' || char === "'"
}

export function appendRomaji(state: RomajiState, char: string): RomajiState {
  if (char.length !== 1) return state
  // 'n' 確定用アポストロフィは従来動作を維持
  if (char === "'") {
    if (state.pending === 'n') return { reading: state.reading + 'ん', pending: '' }
    return state
  }
  const combined = state.pending + char
  const converted = toKana(combined, IME_OPTS)
  const match = converted.match(/[a-z]+$/i)
  const pending = match ? match[0] : ''
  const committed = pending ? converted.slice(0, converted.length - pending.length) : converted
  return { reading: state.reading + committed, pending }
}
