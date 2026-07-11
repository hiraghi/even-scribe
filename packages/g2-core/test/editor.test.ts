import { describe, expect, it } from 'vitest'
import { offsetToCursor } from '../src/editor'

describe('offsetToCursor', () => {
  it('handles empty text', () => {
    expect(offsetToCursor('', 0)).toEqual({ offset: 0, line: 1, col: 1 })
  })

  it('handles line starts and ends', () => {
    expect(offsetToCursor('abc', 3)).toEqual({ offset: 3, line: 1, col: 4 })
    expect(offsetToCursor('abc\ndef', 4)).toEqual({ offset: 4, line: 2, col: 1 })
    expect(offsetToCursor('abc\ndef', 7)).toEqual({ offset: 7, line: 2, col: 4 })
  })

  it('clamps offsets', () => {
    expect(offsetToCursor('abc', -1)).toEqual({ offset: 0, line: 1, col: 1 })
    expect(offsetToCursor('abc', 99)).toEqual({ offset: 3, line: 1, col: 4 })
  })
})
