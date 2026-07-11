import { measureTextWrap } from '@evenrealities/pretext'

export type MeasureFn = (text: string, widthPx: number) => { lineCount: number }

export interface PaginateBox {
  widthPx: number
  heightPx: number
  lineHeightPx: number
}

export function paginate(source: string, box: PaginateBox, measure: MeasureFn): string[] {
  const maxLines = maxLinesFor(box)
  if (source.length === 0) return ['']

  const pages: string[] = []
  let current = ''

  for (const paragraph of source.split(/\n{2,}/)) {
    const candidates = measure(paragraph, box.widthPx).lineCount > maxLines ? splitParagraph(paragraph, maxLines, box.widthPx, measure) : [paragraph]

    for (const candidate of candidates) {
      if (current.length === 0) {
        current = candidate
        continue
      }

      const combined = `${current}\n\n${candidate}`
      if (measure(combined, box.widthPx).lineCount <= maxLines) {
        current = combined
      } else {
        pages.push(current)
        current = candidate
      }
    }
  }

  pages.push(current)
  return pages
}

export function createPretextMeasure(): MeasureFn {
  return (text, widthPx) => {
    try {
      return measureTextWrap(text, widthPx)
    } catch {
      return approximateMeasure(text, widthPx)
    }
  }
}

function splitParagraph(paragraph: string, maxLines: number, widthPx: number, measure: MeasureFn): string[] {
  if (paragraph.length === 0) return ['']

  const chunks: string[] = []
  let current = ''

  for (const token of tokenize(paragraph)) {
    const candidate = `${current}${token}`
    if (current.length === 0 || measure(candidate, widthPx).lineCount <= maxLines) {
      current = candidate
      continue
    }

    chunks.push(current.trimEnd())
    current = token.trimStart()

    while (current.length > 0 && measure(current, widthPx).lineCount > maxLines) {
      const hard = hardSplit(current, maxLines, widthPx, measure)
      chunks.push(hard.head)
      current = hard.tail
    }
  }

  if (current.length > 0) chunks.push(current.trimEnd())
  return chunks.length > 0 ? chunks : ['']
}

function tokenize(paragraph: string): string[] {
  const tokens = paragraph.match(/\S+\s*/g)
  return tokens ?? [paragraph]
}

function hardSplit(text: string, maxLines: number, widthPx: number, measure: MeasureFn): { head: string; tail: string } {
  let low = 1
  let high = text.length
  let best = 1

  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    if (measure(text.slice(0, mid), widthPx).lineCount <= maxLines) {
      best = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }

  return {
    head: text.slice(0, best).trimEnd(),
    tail: text.slice(best).trimStart(),
  }
}

function approximateMeasure(text: string, widthPx: number): { lineCount: number } {
  const charsPerLine = Math.max(1, Math.floor(widthPx / 14))
  const lineCount = text.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / charsPerLine)), 0)
  return { lineCount }
}

function maxLinesFor(box: PaginateBox): number {
  return Math.max(1, Math.floor(box.heightPx / box.lineHeightPx))
}
