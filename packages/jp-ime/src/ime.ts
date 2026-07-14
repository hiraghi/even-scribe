import { toKatakana } from 'wanakana'
import { appendRomaji, type RomajiState } from './romaji'

export interface ImeState extends RomajiState {
  mode: 'direct' | 'kana'
  convStyle: 'classic' | 'live'
  raw: string
  candidates: string[] | null
  selected: number
  splitLength: number
  lookupFailed: boolean
  suggesting: boolean
}

export interface ImeKeyResult {
  ime: ImeState
  commit?: string
  lookup?: string
  lookupImmediate?: boolean
  learn?: ImeLearning
  action?: 'discard'
}

export interface ImeLearning {
  reading: string
  candidate: string
}

export const SYMBOL_CANDIDATES: Record<string, string[]> = {
  '.': ['。', '．', '.', '‥', '…'],
  ',': ['、', '，', ',', '・'],
  '[': ['「', '［', '[', '【', '『', '〈', '《'],
  ']': ['」', '］', ']', '】', '』', '〉', '》'],
  '(': ['（', '(', '「', '【'],
  ')': ['）', ')', '」', '】'],
  '!': ['！', '!', '‼', '⁉'],
  '?': ['？', '?', '⁇', '⁉'],
  '<': ['＜', '<', '〈', '≦', '《'],
  '>': ['＞', '>', '〉', '≧', '》'],
  '^': ['＾', '^', '↑'],
  '_': ['＿', '_', '―'],
  '"': ['”', '“', '″'],
  '#': ['＃', '#', '♯'],
  '$': ['＄', '$'],
  '%': ['％', '%'],
  '&': ['＆', '&'],
  ':': ['：', ':'],
  ';': ['；', ';'],
  '/': ['／', '/', '・'],
  '~': ['〜', '～', '~'],
  '=': ['＝', '=', '≒', '≠'],
  '+': ['＋', '+'],
  '*': ['＊', '*', '×', '※'],
}

const SYMBOL_LIGATURES: Record<string, string[]> = {
  '!?': ['⁉'],
  '?!': ['⁈'],
  '!!': ['‼'],
  '??': ['⁇'],
  '...': ['…'],
  '--': ['―', '—'],
  '->': ['→'],
  '<-': ['←'],
  '=>': ['⇒'],
  '[[': ['【【'],
}

function symbolCandidates(key: string): string[] | undefined {
  return key.length === 1 ? SYMBOL_CANDIDATES[key] : undefined
}

export function symbolStackCandidates(seq: string): string[] {
  if (seq.length === 1) return SYMBOL_CANDIDATES[seq] ?? [seq]
  const fullwidth = [...seq].map(char => SYMBOL_CANDIDATES[char]?.[0] ?? char).join('')
  return [...new Set([fullwidth, ...(SYMBOL_LIGATURES[seq] ?? []), seq])]
}

// editor 側のキー振り分けゲート用: このキーが IME で全角記号になるか
export function isPunctKey(key: string): boolean {
  return symbolCandidates(key) !== undefined
}

export function createIme(mode: ImeState['mode'], convStyle: ImeState['convStyle'] = 'classic'): ImeState {
  return {
    mode,
    convStyle,
    reading: '',
    pending: '',
    raw: '',
    candidates: null,
    selected: 0,
    splitLength: 0,
    lookupFailed: false,
    suggesting: false,
  }
}

export function imeComposing(ime: ImeState): string | undefined {
  const text = `${ime.reading}${ime.pending}`
  if (text.length === 0 && ime.candidates !== null) return ime.candidates[ime.selected] ?? ime.candidates[0]
  return text.length > 0 ? text : undefined
}

function activeLen(ime: ImeState): number {
  return ime.splitLength > 0 ? ime.splitLength : ime.reading.length
}

// 末尾に単独の 'n'（未確定ローマ字）が残ったまま確定/変換する時、通常の IME と同じく
// 'ん' として扱う。「はいふn」→「はいふん」。pending が 'n' 以外なら何もしない。
function resolvePendingN(ime: ImeState): ImeState {
  if (ime.pending !== 'n') return ime
  return { ...ime, reading: ime.reading + 'ん', pending: '', raw: ime.raw }
}

export function reduceImeKey(ime: ImeState, key: string): ImeKeyResult {
  // ===== 候補（変換）表示中 =====
  if (ime.candidates !== null && !ime.suggesting) {
    if (key === 'ArrowUp') return { ime: moveImeSelection(ime, -1) }
    if (key === 'ArrowDown') return { ime: moveImeSelection(ime, 1) }
    if (key === 'Space') return { ime: moveImeSelection(ime, 1, { wrap: true }) }
    // G2 は候補を横一列で描くので ←/→ を候補切替に、変換範囲の伸縮は Shift+←/→ に割り当てる。
    if (key === 'ArrowLeft') return { ime: moveImeSelection(ime, -1) }
    if (key === 'ArrowRight') return { ime: moveImeSelection(ime, 1) }
    if (key === 'Shift+ArrowLeft') return resizeConversion(ime, -1)
    if (key === 'Shift+ArrowRight') return resizeConversion(ime, 1)
    const nextSymbolCandidates = symbolCandidates(key)
    if (isSymbolCandidateState(ime) && nextSymbolCandidates) {
      const seq = ime.raw + key
      return { ime: symbolCandidateIme(ime.mode, ime.convStyle, seq, symbolStackCandidates(seq)) }
    }
    if (/^[1-9]$/.test(key)) return confirmImeCandidate(ime, Number(key) - 1)
    if (key.startsWith('Latin:') || isCompositionKey(key)) return confirmThenComposition(ime, key)
    if (key === 'Enter') return confirmImeCandidate(ime)
    if (key === 'Escape') return { ime: toReadingEdit(ime) }
    if (key === 'Backspace' && isSymbolCandidateState(ime)) {
      const seq = ime.raw.slice(0, -1)
      return seq.length === 0
        ? { ime: toReadingEdit(ime) }
        : { ime: symbolCandidateIme(ime.mode, ime.convStyle, seq, symbolStackCandidates(seq)) }
    }
    if (key === 'Backspace') return { ime: toReadingEdit(ime) }
    if (nextSymbolCandidates) return confirmThenText(ime, '', symbolCandidateIme(ime.mode, ime.convStyle, key, nextSymbolCandidates))
    return { ime }
  }

  // ===== 逐次候補表示中 =====
  if (ime.candidates !== null && ime.suggesting) {
    if (key === 'Enter') return confirmImeCandidate(ime)
    if (key === 'ArrowUp' || key === 'ArrowLeft') return { ime: moveImeSelection(ime, -1) }
    if (key === 'ArrowDown' || key === 'ArrowRight' || key === 'Space') return { ime: moveImeSelection(ime, 1, { wrap: key === 'Space' }) }
    if (key === 'Shift+ArrowLeft') return resizeConversion(ime, -1)
    if (key === 'Shift+ArrowRight') return resizeConversion(ime, 1)
    if (key === 'Escape') return { ime: toReadingEdit(ime) }
    if (key === 'Backspace') return continueLiveComposition(backspaceIme(ime).ime)
    if (key.startsWith('Latin:') || isCompositionKey(key)) return appendComposition(ime, key)
    const candidates = symbolCandidates(key)
    if (candidates) return confirmThenText(ime, '', symbolCandidateIme(ime.mode, ime.convStyle, key, candidates))
    return { ime }
  }

  // ===== 読み編集中（候補なし）=====
  if (key === 'Escape') {
    if (ime.reading === '' && ime.pending === '') return { ime, action: 'discard' }
    return { ime: cancelIme(ime) }
  }
  if (key === 'Enter') {
    const resolved = resolvePendingN(ime)
    return { ime: createIme(ime.mode, ime.convStyle), commit: resolved.reading + resolved.pending }
  }
  if (key === 'F10') return { ime: createIme(ime.mode, ime.convStyle), commit: ime.raw }
  if (key === 'Backspace') return backspaceIme(ime)
  // 変換前は消費のみ（カーソル移動防止）。範囲選択用の Shift+←/→ も同様に消費する。
  if (key === 'ArrowLeft' || key === 'ArrowRight' || key === 'Shift+ArrowLeft' || key === 'Shift+ArrowRight') return { ime }
  if (key === 'Space') {
    const resolved = resolvePendingN(ime)
    if (!resolved.reading) {
      // 変換前の pending のみ（かな未生成）。Shift入力(raw に大文字)なら
      // 全角空白で捨てずに raw（大文字保持）をそのまま確定する。
      if (resolved.pending && /[A-Z]/.test(ime.raw)) {
        return { ime: createIme(ime.mode, ime.convStyle), commit: ime.raw }
      }
      return { ime: createIme(ime.mode, ime.convStyle), commit: '　' }
    }
    return {
      ime: { ...resolved, candidates: null, selected: 0, splitLength: resolved.reading.length, lookupFailed: false, suggesting: false },
      lookup: resolved.reading,
      lookupImmediate: true,
    }
  }
  if (key.startsWith('Latin:')) {
    return appendComposition(ime, key)
  }
  const candidates = symbolCandidates(key)
  if (candidates) {
    const resolved = resolvePendingN(ime)
    if (resolved.reading || resolved.pending) {
      return { ime: symbolCandidateIme(ime.mode, ime.convStyle, key, symbolStackCandidates(key)), commit: resolved.reading + resolved.pending }
    }
    return { ime: symbolCandidateIme(ime.mode, ime.convStyle, key, symbolStackCandidates(key)) }
  }
  if (key.length !== 1) return { ime }
  return appendComposition(ime, key)
}

function isCompositionKey(key: string): boolean {
  return key.length === 1 && (/^[a-z0-9]$/i.test(key) || key === '-' || key === "'")
}

function appendComposition(ime: ImeState, key: string): ImeKeyResult {
  const latin = key.startsWith('Latin:')
  const raw = latin ? key.slice('Latin:'.length) : key
  const converted = appendRomaji({ reading: ime.reading, pending: ime.pending }, latin ? raw.toLowerCase() : raw)
  const suggesting = ime.convStyle === 'live' && converted.reading.length > 0
  const nextIme: ImeState = {
    ...ime,
    ...converted,
    raw: ime.raw + raw,
    candidates: null,
    selected: 0,
    splitLength: 0,
    lookupFailed: false,
    suggesting,
  }
  return { ime: nextIme, lookup: suggesting ? converted.reading : undefined }
}

function continueLiveComposition(ime: ImeState): ImeKeyResult {
  const suggesting = ime.reading.length > 0
  const nextIme = { ...ime, suggesting }
  return { ime: nextIme, lookup: suggesting ? ime.reading : undefined }
}

export function moveImeSelection(ime: ImeState, delta: number, opts: { wrap?: boolean } = {}): ImeState {
  if (ime.candidates === null) return ime
  const length = ime.candidates.length
  if (length === 0) return ime
  const max = Math.max(0, length - 1)
  const selected = opts.wrap ? (ime.selected + delta + length) % length : clamp(ime.selected + delta, 0, max)
  return { ...ime, selected }
}

// 左右キー: 確定範囲（読み prefix 長）を伸縮して prefix を再lookup
function resizeConversion(ime: ImeState, delta: number): ImeKeyResult {
  const current = activeLen(ime)
  const len = clamp(current + delta, 1, ime.reading.length)
  if (len === current) return { ime }
  return {
    ime: { ...ime, splitLength: len, selected: 0, suggesting: ime.convStyle === 'live' && ime.suggesting },
    lookup: ime.reading.slice(0, len),
    lookupImmediate: true,
  }
}

// 候補中に Esc/Backspace: 変換をやめて読み編集に戻す
function toReadingEdit(ime: ImeState): ImeState {
  return { ...ime, candidates: null, selected: 0, splitLength: 0, lookupFailed: false, suggesting: false }
}

export function confirmImeCandidate(
  ime: ImeState,
  index = ime.selected,
): { ime: ImeState; commit: string; lookup?: string; lookupImmediate?: boolean; learn?: ImeLearning } {
  const len = activeLen(ime)
  const candidate = ime.candidates?.[clamp(index, 0, Math.max(0, ime.candidates.length - 1))] ?? ime.reading.slice(0, len)
  const rest = ime.reading.slice(len)
  const learn = learningFor(ime.reading.slice(0, len), candidate)
  if (rest.length === 0) return { ime: createIme(ime.mode, ime.convStyle), commit: candidate, learn }
  return {
    ime: { ...createIme(ime.mode, ime.convStyle), reading: rest, pending: ime.pending, splitLength: rest.length, suggesting: ime.convStyle === 'live' },
    commit: candidate,
    lookup: rest,
    lookupImmediate: true,
    learn,
  }
}

// 候補確定 + 追加テキスト（記号 or 新規入力開始）。現候補＋残り読みを捨てずに確定する。
function confirmThenText(ime: ImeState, appendText: string, nextIme: ImeState): ImeKeyResult {
  const len = activeLen(ime)
  const candidate = ime.candidates?.[clamp(ime.selected, 0, Math.max(0, ime.candidates.length - 1))] ?? ime.reading.slice(0, len)
  const rest = ime.reading.slice(len) + ime.pending
  return { ime: nextIme, commit: candidate + rest + appendText, learn: learningFor(ime.reading.slice(0, len), candidate) }
}

function confirmThenComposition(ime: ImeState, key: string): ImeKeyResult {
  const next = appendComposition(createIme(ime.mode, ime.convStyle), key)
  const confirmed = confirmThenText(ime, '', next.ime)
  return { ...confirmed, lookup: next.lookup }
}

export function cancelIme(ime: ImeState): ImeState {
  return createIme(ime.mode, ime.convStyle)
}

export function applyCandidates(ime: ImeState, reading: string, candidates: string[], error = false): ImeState {
  const key = ime.reading.slice(0, activeLen(ime))
  if (key !== reading) return ime // stale
  if (error) return { ...ime, candidates: null, selected: 0, lookupFailed: true, suggesting: false }
  const base = candidates.length > 0 ? candidates : [reading]
  const rawExtra = ime.splitLength === 0 || ime.splitLength >= ime.reading.length ? ime.raw : ''
  const katakana = toKatakana(reading)
  const shiftLatin = /[A-Z]/.test(rawExtra) && /^[A-Za-z0-9'-]+$/.test(rawExtra)
  const ordered = shiftLatin ? [rawExtra, ...base, katakana] : [...base, katakana, rawExtra]
  return { ...ime, candidates: [...new Set(ordered.filter(x => x !== ''))], selected: 0, lookupFailed: false }
}

function backspaceIme(ime: ImeState): ImeKeyResult {
  const nextIme: ImeState =
    ime.pending.length > 0
      ? {
          ...ime,
          pending: ime.pending.slice(0, -1),
          raw: ime.raw.slice(0, -1),
          candidates: null,
          selected: 0,
          splitLength: 0,
          lookupFailed: false,
          suggesting: false,
        }
      : {
          ...ime,
          reading: ime.reading.slice(0, -1),
          raw: ime.raw.slice(0, -1),
          candidates: null,
          selected: 0,
          splitLength: 0,
          lookupFailed: false,
          suggesting: false,
        }
  return { ime: nextIme }
}

function symbolCandidateIme(mode: ImeState['mode'], convStyle: ImeState['convStyle'], raw: string, candidates: string[]): ImeState {
  return { ...createIme(mode, convStyle), raw, candidates, selected: 0, splitLength: 0, suggesting: false }
}

function isSymbolCandidateState(ime: ImeState): boolean {
  return ime.candidates !== null && ime.reading === '' && ime.pending === ''
}

function learningFor(reading: string, candidate: string): ImeLearning | undefined {
  if (reading.length === 0 || candidate === reading) return undefined
  return { reading, candidate }
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.min(max, Math.max(min, value))
}
