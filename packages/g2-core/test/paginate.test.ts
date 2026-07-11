import { describe, expect, it } from 'vitest'
import { paginate, type MeasureFn } from '../src/paginate'

const box = { widthPx: 300, heightPx: 80, lineHeightPx: 20 }
const tallerBox = { widthPx: 300, heightPx: 120, lineHeightPx: 20 }
const measure: MeasureFn = text => {
  const lines = text.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / 30)), 0)
  return { lineCount: lines }
}

describe('paginate', () => {
  it('packs multiple paragraphs into a page', () => {
    expect(paginate('one\n\ntwo\n\nthree', tallerBox, measure)).toEqual(['one\n\ntwo\n\nthree'])
  })

  it('splits long paragraphs over maxLines at word boundaries', () => {
    const source = Array.from({ length: 30 }, (_, index) => `word${index}`).join(' ')
    const pages = paginate(source, box, measure)
    expect(pages.length).toBeGreaterThan(1)
    expect(pages[0].endsWith(' ')).toBe(false)
  })

  it('returns one empty page for empty text', () => {
    expect(paginate('', box, measure)).toEqual([''])
  })

  it('keeps every page within maxLines under the injected measure', () => {
    const source = ['short paragraph', Array.from({ length: 40 }, (_, index) => `token${index}`).join(' '), 'tail'].join('\n\n')
    const pages = paginate(source, box, measure)
    for (const page of pages) expect(measure(page, box.widthPx).lineCount).toBeLessThanOrEqual(4)
  })
})
