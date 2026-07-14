import { describe, expect, it } from 'vitest'
import { appendRomaji, canStartComposition, type RomajiState } from '../src/romaji'

describe('appendRomaji', () => {
  it.each([
    ['ka', 'か'],
    ['kya', 'きゃ'],
    ['kka', 'っか'],
    ["n'", 'ん'],
    ['nn', 'ん'],
    ['shi', 'し'],
    ['si', 'し'],
    ['tsu', 'つ'],
    ['tu', 'つ'],
    ['fu', 'ふ'],
    ['hu', 'ふ'],
    ['-', 'ー'],
    ['fa', 'ふぁ'],
    ['fi', 'ふぃ'],
    ['fe', 'ふぇ'],
    ['fo', 'ふぉ'],
    ['va', 'ゔぁ'],
    ['tsa', 'つぁ'],
    ['che', 'ちぇ'],
    ['ja', 'じゃ'],
    ['di', 'ぢ'],
    ['du', 'づ'],
    ['tcha', 'っちゃ'],
    ['matcha', 'まっちゃ'],
    ['.', '。'],
    [',', '、'],
    ['[', '「'],
    [']', '」'],
  ])('converts %s to %s', (source, expected) => {
    expect(type(source).reading).toBe(expected)
  })

  it('keeps an unfinished consonant pending', () => {
    expect(type('k')).toEqual({ reading: '', pending: 'k' })
  })
})

describe('canStartComposition', () => {
  it('accepts table-derived starting characters and rejects non-starters', () => {
    expect(canStartComposition('k')).toBe(true)
    expect(canStartComposition('K')).toBe(true)
    expect(canStartComposition('-')).toBe(true)
    expect(canStartComposition('Backspace')).toBe(false)
    expect(canStartComposition('1')).toBe(true)
  })
})

function type(source: string): RomajiState {
  let state: RomajiState = { reading: '', pending: '' }
  for (const char of source) state = appendRomaji(state, char)
  return state
}
