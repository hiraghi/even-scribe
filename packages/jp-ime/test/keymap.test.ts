import { describe, expect, it } from 'vitest'
import { toImeKey } from '../src/keymap'

// toImeKey は event の key / shiftKey / ctrlKey / metaKey / altKey のみ参照するため、
// DOM の KeyboardEvent を使わずプレーンオブジェクトで検証する。
function ev(part: Partial<KeyboardEvent>): KeyboardEvent {
  return { ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...part } as KeyboardEvent
}

describe('toImeKey', () => {
  it('distinguishes plain arrows (candidate switch) from shift+arrows (range resize)', () => {
    expect(toImeKey(ev({ key: 'ArrowLeft' }))).toBe('ArrowLeft')
    expect(toImeKey(ev({ key: 'ArrowRight' }))).toBe('ArrowRight')
    expect(toImeKey(ev({ key: 'ArrowLeft', shiftKey: true }))).toBe('Shift+ArrowLeft')
    expect(toImeKey(ev({ key: 'ArrowRight', shiftKey: true }))).toBe('Shift+ArrowRight')
  })

  it('still maps the basic composing keys', () => {
    expect(toImeKey(ev({ key: ' ' }))).toBe('Space')
    expect(toImeKey(ev({ key: 'Enter' }))).toBe('Enter')
    expect(toImeKey(ev({ key: 'k' }))).toBe('k')
    expect(toImeKey(ev({ key: 'a', ctrlKey: true }))).toBeNull()
  })

  it('maps shift+letters to Latin insert tokens', () => {
    expect(toImeKey(ev({ key: 'A', shiftKey: true }))).toBe('Latin:A')
    expect(toImeKey(ev({ key: 'z', shiftKey: true }))).toBe('Latin:Z')
    expect(toImeKey(ev({ key: 'a' }))).toBe('a')
  })
})
