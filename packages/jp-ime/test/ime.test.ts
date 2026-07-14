import { describe, expect, it } from 'vitest'
import {
  applyCandidates,
  confirmImeCandidate,
  createIme,
  imeComposing,
  isPunctKey,
  moveImeSelection,
  reduceImeKey,
  symbolStackCandidates,
  type ImeState,
} from '../src'

describe('IME reducer', () => {
  it('builds a kana reading without lookup in classic mode and converts on Space', () => {
    const pending = reduceImeKey(createIme('kana'), 'k')
    expect(pending.lookup).toBeUndefined()
    expect(pending.ime.pending).toBe('k')
    expect(imeComposing(pending.ime)).toBe('k')

    const typed = reduceImeKey(pending.ime, 'a')
    expect(typed.lookup).toBeUndefined()
    expect(typed.ime.suggesting).toBe(false)
    expect(typed.ime.reading).toBe('か')
    expect(imeComposing(typed.ime)).toBe('か')

    const space = reduceImeKey(typed.ime, 'Space')
    expect(space.lookup).toBe('か')
    expect(space.lookupImmediate).toBe(true)
    expect(space.ime.suggesting).toBe(false)
    expect(space.ime.splitLength).toBe(1)
  })

  it('requests live lookup after kana is available in live mode', () => {
    const pending = reduceImeKey(createIme('kana', 'live'), 'k')
    const typed = reduceImeKey(pending.ime, 'a')

    expect(typed.lookup).toBe('か')
    expect(typed.ime.suggesting).toBe(true)
    expect(typed.ime.convStyle).toBe('live')
  })

  it('moves, wraps, confirms, and returns to reading edit on escape', () => {
    const ime = candidateIme()
    expect(moveImeSelection(ime, 1).selected).toBe(1)
    expect(moveImeSelection({ ...ime, selected: 2 }, 1, { wrap: true }).selected).toBe(0)
    expect(confirmImeCandidate({ ...ime, selected: 1 })).toEqual({
      ime: createIme('kana'),
      commit: '課',
      learn: { reading: 'か', candidate: '課' },
    })
    expect(reduceImeKey(ime, 'Escape').ime).toMatchObject({ candidates: null, reading: 'か' })
  })

  it('supports number, enter, and F10 commits', () => {
    expect(reduceImeKey(candidateIme(), '2')).toEqual({ ime: createIme('kana'), commit: '課', learn: { reading: 'か', candidate: '課' } })
    expect(reduceImeKey(candidateIme(), 'Enter')).toEqual({ ime: createIme('kana'), commit: '蚊', learn: { reading: 'か', candidate: '蚊' } })
    expect(reduceImeKey({ ...candidateIme(), candidates: null }, 'F10')).toEqual({ ime: createIme('kana'), commit: 'ka' })
  })

  it('handles escape discard and backspace without auto-lookup', () => {
    expect(reduceImeKey(createIme('kana'), 'Escape').action).toBe('discard')
    const back = reduceImeKey({ ...createIme('kana'), reading: 'かな', raw: 'kana' }, 'Backspace')
    expect(back.ime).toMatchObject({ reading: 'か', raw: 'kan' })
    expect(back.lookup).toBeUndefined()
  })

  it('resizes the conversion range with shift+arrow keys', () => {
    const ime: ImeState = {
      mode: 'kana',
      convStyle: 'classic',
      reading: 'きょう',
      pending: '',
      raw: 'kyou',
      candidates: ['今日', '京'],
      selected: 0,
      splitLength: 3,
      lookupFailed: false,
      suggesting: false,
    }
    const left = reduceImeKey(ime, 'Shift+ArrowLeft')
    expect(left.ime.splitLength).toBe(2)
    expect(left.lookup).toBe('きょ')
    const right = reduceImeKey(left.ime, 'Shift+ArrowRight')
    expect(right.ime.splitLength).toBe(3)
    expect(right.lookup).toBe('きょう')
  })

  it('switches candidates with plain arrow keys (G2 shows candidates in a row)', () => {
    const ime: ImeState = {
      mode: 'kana',
      convStyle: 'classic',
      reading: 'きょう',
      pending: '',
      raw: 'kyou',
      candidates: ['今日', '京', 'きょう'],
      selected: 0,
      splitLength: 3,
      lookupFailed: false,
      suggesting: false,
    }
    const right = reduceImeKey(ime, 'ArrowRight')
    expect(right.ime.selected).toBe(1)
    expect(right.lookup).toBeUndefined()
    const left = reduceImeKey(right.ime, 'ArrowLeft')
    expect(left.ime.selected).toBe(0)
  })

  it('treats a trailing lone "n" as ん when confirming or converting', () => {
    const base = { ...createIme('kana'), reading: 'はいふ', pending: 'n', raw: 'haihun' }
    expect(reduceImeKey(base, 'Enter').commit).toBe('はいふん')
    const space = reduceImeKey(base, 'Space')
    expect(space.lookup).toBe('はいふん')
    expect(space.ime.reading).toBe('はいふん')
    const symbol = reduceImeKey(base, '.')
    expect(symbol.commit).toBeUndefined()
    expect(symbol.ime.reading).toBe('はいふん。')
    expect(symbol.ime.splitLength).toBe(4)
    // 単独 'n' だけの状態でも Space でひらがな化して変換にかける
    const lone = { ...createIme('kana'), reading: '', pending: 'n', raw: 'n' }
    expect(reduceImeKey(lone, 'Space').lookup).toBe('ん')
  })

  it('commits the converted prefix and keeps the rest as reading', () => {
    const ime: ImeState = {
      mode: 'kana',
      convStyle: 'classic',
      reading: 'きょうは',
      pending: '',
      raw: 'kyouha',
      candidates: ['今日'],
      selected: 0,
      splitLength: 3,
      lookupFailed: false,
      suggesting: false,
    }
    const result = confirmImeCandidate(ime)
    expect(result.commit).toBe('今日')
    expect(result.ime.reading).toBe('は')
    expect(result.ime.candidates).toBeNull()
    expect(result.ime.splitLength).toBe(1)
    expect(result.lookup).toBe('は')
    expect(result.lookupImmediate).toBe(true)
  })

  it('commits the current candidate before opening symbol candidates', () => {
    const result = reduceImeKey(candidateIme(), '.')
    expect(result.commit).toBe('蚊')
    expect(result.ime.candidates?.slice(0, 2)).toEqual(['。', '．'])
    expect(imeComposing(result.ime)).toBe('。')
  })

  it('commits the current candidate before starting a new character', () => {
    const result = reduceImeKey(candidateIme(), 'k')
    expect(result.commit).toBe('蚊')
    expect(result.ime.pending).toBe('k')
    expect(result.learn).toEqual({ reading: 'か', candidate: '蚊' })
  })

  it('appends a symbol to the reading during composition instead of committing', () => {
    const result = reduceImeKey({ ...createIme('kana'), reading: 'あ' }, '.')
    expect(result.commit).toBeUndefined()
    expect(result.ime.reading).toBe('あ。')
    expect(result.ime.splitLength).toBe(1)
    expect(result.ime.candidates).toBeNull()
  })

  it('converts only the kana prefix and keeps trailing symbols in one flow', () => {
    // きょう + ！ : 全角！を読みに追記し、確定はしない
    const composed = reduceImeKey({ ...createIme('kana'), reading: 'きょう', raw: 'kyou' }, '!')
    expect(composed.commit).toBeUndefined()
    expect(composed.ime.reading).toBe('きょう！')
    expect(composed.ime.splitLength).toBe(3)
    // さらに ？ を重ねても splitLength(かな長)は保持
    const composed2 = reduceImeKey(composed.ime, '?')
    expect(composed2.ime.reading).toBe('きょう！？')
    expect(composed2.ime.splitLength).toBe(3)
    // Space はかな接頭辞だけを lookup する
    const space = reduceImeKey(composed2.ime, 'Space')
    expect(space.lookup).toBe('きょう')
    expect(space.ime.splitLength).toBe(3)
    // 候補確定時、記号のみの残りは自動確定せず未確定の合成として残す
    // (かな残り「環境|いぞん」と同じ『変換待ち』挙動)
    const withCandidates = applyCandidates(space.ime, 'きょう', ['今日'])
    const confirmed = confirmImeCandidate(withCandidates)
    expect(confirmed.commit).toBe('今日')
    expect(confirmed.ime.reading).toBe('！？')
    expect(confirmed.ime.candidates).toBeNull()
    // 残った ！？ は Enter でそのまま確定できる
    expect(reduceImeKey(confirmed.ime, 'Enter').commit).toBe('！？')
  })

  it('opens symbol candidates from an empty composing state and commits with Enter', () => {
    const period = reduceImeKey(createIme('kana'), '.')
    expect(period.commit).toBeUndefined()
    expect(period.ime.candidates?.slice(0, 3)).toEqual(['。', '．', '.'])
    expect(imeComposing(period.ime)).toBe('。')
    expect(reduceImeKey(period.ime, 'Enter')).toEqual({ ime: createIme('kana'), commit: '。' })

    expect(reduceImeKey(createIme('kana'), '[').ime.candidates?.slice(0, 4)).toEqual(['「', '［', '[', '【'])
    expect(reduceImeKey(createIme('kana'), '?').ime.candidates?.slice(0, 2)).toEqual(['？', '?'])
  })

  it('stacks consecutive symbols into a single candidate unit', () => {
    const bang = reduceImeKey(createIme('kana'), '!')
    const bangQuestion = reduceImeKey(bang.ime, '?')
    expect(bang.commit).toBeUndefined()
    expect(bangQuestion.commit).toBeUndefined()
    expect(bangQuestion.ime.raw).toBe('!?')
    expect(bangQuestion.ime.candidates).toEqual(['！？', '⁉', '!?'])
    expect(reduceImeKey(bangQuestion.ime, 'Enter')).toEqual({ ime: createIme('kana'), commit: '！？' })

    const ligature = reduceImeKey(reduceImeKey(bangQuestion.ime, 'Space').ime, 'Enter')
    expect(ligature).toEqual({ ime: createIme('kana'), commit: '⁉' })

    const periodThenKana = reduceImeKey(reduceImeKey(createIme('kana'), '.').ime, 'k')
    expect(periodThenKana.commit).toBe('。')
    expect(periodThenKana.ime.pending).toBe('k')
  })

  it('offers common stacked symbol alternatives', () => {
    expect(reduceImeKey(reduceImeKey(createIme('kana'), '!').ime, '!').ime.candidates).toContain('‼')
    expect(reduceImeKey(reduceImeKey(createIme('kana'), '?').ime, '?').ime.candidates).toContain('⁇')

    const brackets = reduceImeKey(reduceImeKey(createIme('kana'), '[').ime, '[')
    expect(brackets.ime.candidates).toEqual(['「「', '【【', '[['])
    expect(reduceImeKey(brackets.ime, 'Enter')).toEqual({ ime: createIme('kana'), commit: '「「' })

    expect(symbolStackCandidates('...')).toEqual(['。。。', '…', '...'])

    const fromKanjiCandidate = reduceImeKey(candidateIme(), '!')
    expect(fromKanjiCandidate.commit).toBe('蚊')
    expect(fromKanjiCandidate.ime.raw).toBe('!')
    expect(fromKanjiCandidate.ime.candidates).toEqual(['！', '!', '‼', '⁉'])
  })

  it('removes one symbol at a time from a symbol stack', () => {
    const stacked = reduceImeKey(reduceImeKey(createIme('kana'), '!').ime, '?')
    const oneLeft = reduceImeKey(stacked.ime, 'Backspace')
    expect(oneLeft.ime.raw).toBe('!')
    expect(oneLeft.ime.candidates).toEqual(['！', '!', '‼', '⁉'])

    const cleared = reduceImeKey(oneLeft.ime, 'Backspace')
    expect(cleared.ime.candidates).toBeNull()
  })

  it('keeps digits and hyphens in the reading for a single conversion lookup', () => {
    const digits = ['1', '2', '3', '4', '5'].reduce((ime, key) => reduceImeKey(ime, key).ime, createIme('kana'))
    expect(digits.reading).toBe('12345')
    expect(digits.candidates).toBeNull()
    expect(reduceImeKey(digits, 'Space').lookup).toBe('12345')

    const longVowel = ['r', 'a', '-', 'm', 'e', 'n'].reduce((ime, key) => reduceImeKey(ime, key).ime, createIme('kana'))
    expect(longVowel.reading).toBe('らーめ')
    expect(longVowel.pending).toBe('n')
    expect(reduceImeKey(longVowel, 'Space').lookup).toBe('らーめん')
  })

  it('classifies punct keys for the editor routing gate', () => {
    for (const key of ['.', ',', '[', ']', '^', '(', ')', '!', '"', '#', '$', '%', '&', '>', '?', '<', '_', '/', '~', '=', '+', '*']) {
      expect(isPunctKey(key)).toBe(true)
    }
    expect(isPunctKey('a')).toBe(false)
    expect(isPunctKey('-')).toBe(false)
    expect(isPunctKey('1')).toBe(false)
    expect(isPunctKey("'")).toBe(false) // n' 確定用に romaji 側で扱う
  })

  it('keeps Shift+Latin text in the composition and preserves its raw case', () => {
    const first = reduceImeKey(createIme('kana'), 'Latin:W')
    expect(first.commit).toBeUndefined()
    expect(first.ime.raw).toBe('W')
    expect(first.ime.pending).toBe('w')

    const mixed = reduceImeKey(first.ime, 'i')
    expect(mixed.ime.raw).toBe('Wi')
    expect(mixed.ime.reading).not.toBe('')

    const converting = reduceImeKey(candidateIme(), 'Latin:A')
    expect(converting.commit).toBe('蚊')
    expect(converting.ime.raw).toBe('A')
    expect(converting.ime.reading).toBe('あ')
  })

  it('uses selected live suggestions for Enter, navigation, and continued input', () => {
    const suggesting = applyCandidates({ ...createIme('kana', 'live'), reading: 'か', raw: 'ka', suggesting: true }, 'か', ['蚊', '課'])
    expect(suggesting.candidates).toEqual(['蚊', '課', 'カ', 'ka'])
    expect(suggesting.suggesting).toBe(true)
    expect(reduceImeKey(suggesting, 'ArrowRight').ime.selected).toBe(1)
    expect(reduceImeKey(suggesting, 'Enter')).toMatchObject({ ime: createIme('kana', 'live'), commit: '蚊' })

    const continued = reduceImeKey(suggesting, 'n')
    expect(continued.commit).toBeUndefined()
    expect(continued.ime.raw).toBe('kan')
    expect(continued.lookup).toBe('か')
  })

  it('commits an empty-reading Space as a full-width Japanese space', () => {
    expect(reduceImeKey(createIme('kana'), 'Space')).toEqual({ ime: createIme('kana'), commit: '　' })
  })

  it('commits Shift consonant input as its case-preserved raw text on Space', () => {
    const l = reduceImeKey(createIme('kana'), 'Latin:L')
    const n = reduceImeKey(l.ime, 'Latin:N')
    const result = reduceImeKey(n.ime, 'Space')

    expect(result.commit).toBe('LN')
    expect(result.ime.reading).toBe('')
  })

  it('applies lookup candidates with katakana and ignores stale readings', () => {
    const ime = { ...createIme('kana'), reading: 'か' }
    const applied = applyCandidates(ime, 'か', ['蚊'])
    expect(applied.candidates).toEqual(['蚊', 'カ']) // カタカナ候補を付与
    expect(applied.lookupFailed).toBe(false)
    expect(applyCandidates(ime, 'か', [])).toMatchObject({ candidates: ['か', 'カ'] })
    expect(applyCandidates(ime, 'か', [], true)).toMatchObject({ candidates: null, lookupFailed: true })
    expect(applyCandidates(ime, 'き', ['木'])).toBe(ime)
  })

  it('prioritizes Shift+Latin raw text while keeping kana candidates reachable', () => {
    const upper = ['Latin:U', 'Latin:I'].reduce((ime, key) => reduceImeKey(ime, key).ime, createIme('kana'))
    const upperCandidates = applyCandidates(upper, upper.reading, ['うい'])

    expect(upperCandidates.candidates).toEqual(['UI', 'うい', 'ウイ'])
    expect(upperCandidates.selected).toBe(0)
    expect(reduceImeKey(upperCandidates, 'Enter').commit).toBe('UI')
    expect(reduceImeKey(upperCandidates, 'Space').ime.selected).toBe(1)

    const lower = ['u', 'i'].reduce((ime, key) => reduceImeKey(ime, key).ime, createIme('kana'))
    const lowerCandidates = applyCandidates(lower, lower.reading, ['うい'])
    expect(lowerCandidates.candidates).toEqual(['うい', 'ウイ', 'ui'])
    expect(lowerCandidates.selected).toBe(0)
  })

  it('leads with the Shift+Latin raw text for words without a learned entry (AI / OOM)', () => {
    const ai = ['Latin:A', 'Latin:I'].reduce((ime, key) => reduceImeKey(ime, key).ime, createIme('kana'))
    const aiCandidates = applyCandidates(ai, ai.reading, ['愛', '相'])
    expect(aiCandidates.candidates?.[0]).toBe('AI')
    expect(aiCandidates.selected).toBe(0)

    const oom = ['Latin:O', 'Latin:O', 'Latin:M'].reduce((ime, key) => reduceImeKey(ime, key).ime, createIme('kana'))
    const oomCandidates = applyCandidates(oom, oom.reading, ['多い'])
    expect(oomCandidates.candidates?.[0]).toBe('OOM')
    expect(oomCandidates.selected).toBe(0)
  })
})

function candidateIme(): ImeState {
  return {
    mode: 'kana',
    convStyle: 'classic',
    reading: 'か',
    pending: '',
    raw: 'ka',
    candidates: ['蚊', '課', '可'],
    selected: 0,
    splitLength: 1,
    lookupFailed: false,
    suggesting: false,
  }
}
