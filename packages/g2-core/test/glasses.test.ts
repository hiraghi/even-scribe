import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  computeStickyTop,
  editLineUnits,
  EDIT_BODY_BOX,
  fitListRow,
  formatEdit,
  formatScreen,
  g2LineEdge,
  initGlasses,
  moveOffsetByG2Line,
  pageOfOffset,
  paginateEdit,
  renderEditDraft,
  renderFlushDelay,
  SINGLE_LINE_SAFETY_PX,
  type EditPage,
} from '../src/glasses'
import { createPretextMeasure, type MeasureFn } from '../src/paginate'
import type { AppState, EditState, ListItem } from '../src/state'

const singleLineWidthPx = EDIT_BODY_BOX.widthPx - SINGLE_LINE_SAFETY_PX

const measure: MeasureFn = text => {
  const lines = text.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / 30)), 0)
  return { lineCount: lines }
}

const wrapFive: MeasureFn = text => {
  const lines = text.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / 5)), 0)
  return { lineCount: lines }
}

const wrapForty: MeasureFn = text => {
  const lines = text.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / 40)), 0)
  return { lineCount: lines }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('edit glasses formatting', () => {
  it('finds the page containing an offset', () => {
    const pages: EditPage[] = [
      { text: 'abc', start: 0, end: 3 },
      { text: 'def', start: 3, end: 6 },
    ]

    expect(pageOfOffset(pages, 0)).toBe(0)
    expect(pageOfOffset(pages, 3)).toBe(1)
    expect(pageOfOffset(pages, 6)).toBe(1)
  })

  it('includes caret marker and Ln/Col header', () => {
    const text = formatEdit(editState({ draft: 'hello', cursor: { offset: 2, line: 1, col: 3 } }))

    expect(text.split('\n')[0]).toBe('EDIT[A] note.md Ln 1,Col 3')
    expect(text).toContain('he█llo')
  })

  it('shows kana IME mode and selected candidates', () => {
    const text = formatEdit(
      editState({
        ime: {
          mode: 'kana',
          convStyle: 'classic',
          reading: 'か',
          pending: '',
          raw: 'ka',
          candidates: ['蚊', '課'],
          selected: 1,
          splitLength: 0,
          lookupFailed: false,
          suggesting: false,
        },
        composing: 'か',
      }),
    )

    expect(text.split('\n')[0]).toBe('EDIT[あ] note.md Ln 1,Col 1')
    expect(text).toContain('1:蚊 [2:課]')
  })

  it('pages long IME candidate footers into one measured display line', () => {
    const pretextMeasure = createPretextMeasure()
    const footer = formatEdit(
      editState({
        ime: {
          mode: 'kana',
          convStyle: 'classic',
          reading: 'ながい',
          pending: '',
          raw: 'nagai',
          candidates: [
            'extraordinarilylongcandidateone',
            'extraordinarilylongcandidatetwo',
            'extraordinarilylongcandidatethree',
            'extraordinarilylongcandidatefour',
          ],
          selected: 0,
          splitLength: 0,
          lookupFailed: false,
          suggesting: false,
        },
        composing: 'ながい',
      }),
      pretextMeasure,
    )
      .split('\n')
      .at(-1) ?? ''

    expect(footer).toBeDefined()
    expect(pretextMeasure(footer, singleLineWidthPx).lineCount).toBe(1)
    expect(footer).toContain('›')
  })

  it('shows the selected candidate page in one footer line while preserving all seven edit rows', () => {
    const candidates = Array.from({ length: 15 }, (_, index) => `candidate-${index + 1}-long`)
    const first = formatEdit(
      editState({
        ime: { ...editState().ime, mode: 'kana', convStyle: 'classic', reading: 'かな', raw: 'kana', candidates, selected: 0 },
        composing: 'かな',
      }),
    )
    const last = formatEdit(
      editState({
        ime: { ...editState().ime, mode: 'kana', convStyle: 'classic', reading: 'かな', raw: 'kana', candidates, selected: 14 },
        composing: 'かな',
      }),
    )

    expect(first.split('\n')).toHaveLength(9)
    expect(first.split('\n').at(-1)).toContain('›')
    expect(last.split('\n')).toHaveLength(9)
    expect(last.split('\n').at(-1)).toContain('[15:candidate-15-long]')
    expect(last.split('\n').at(-1)).toContain('‹')
  })

  it('places the IME mode marker at the start of the EDIT header', () => {
    const directHeader = formatEdit(editState()).split('\n')[0]
    const kanaHeader = formatEdit(
      editState({
        ime: { mode: 'kana', convStyle: 'classic', reading: '', pending: '', raw: '', candidates: null, selected: 0, splitLength: 0, lookupFailed: false, suggesting: false },
      }),
    ).split('\n')[0]

    expect(directHeader.startsWith('EDIT[A] ')).toBe(true)
    expect(kanaHeader.startsWith('EDIT[あ] ')).toBe(true)
    expect(directHeader.endsWith('[A]')).toBe(false)
    expect(kanaHeader.endsWith('[あ]')).toBe(false)
  })

  it('fits long EDIT headers to one measured display line', () => {
    const pretextMeasure = createPretextMeasure()
    const header = formatEdit(
      editState({
        path: 'research/2026-05-14/01-obsidian-local-llm-and-more-words.md',
      }),
      pretextMeasure,
    ).split('\n')[0]

    expect(header.startsWith('EDIT[A] ')).toBe(true)
    expect(header.endsWith('...')).toBe(true)
    expect(pretextMeasure(header, singleLineWidthPx).lineCount).toBe(1)
  })

  it('inserts composing text inside ASCII brackets', () => {
    const text = formatEdit(editState({ draft: 'abc', cursor: { offset: 1, line: 1, col: 2 }, composing: 'かな' }))

    expect(text).toContain('a█[かな]bc')
    expect(text).toContain('IME: かな')
  })

  it('marks the edit footer when IME lookup failed while composing', () => {
    const text = formatEdit(
      editState({
        composing: 'かな',
        ime: { mode: 'kana', convStyle: 'classic', reading: 'かな', pending: '', raw: 'kana', candidates: null, selected: 0, splitLength: 0, lookupFailed: true, suggesting: false },
      }),
    )

    expect(text.split('\n').at(-1)).toBe('IME: かな !err')
  })

  it('shows conflict status with an ASCII marker', () => {
    const text = formatEdit(editState({ status: 'conflict', message: 'changed' }))

    expect(text).toContain('!conflict')
  })

  it('paginates edit text to measured 8-line pages and keeps the caret visible', () => {
    const draft = Array.from({ length: 28 }, (_, index) => `line-${index.toString().padStart(2, '0')} ${'x'.repeat(35)}`).join('\n')
    const caretOffset = draft.indexOf('line-21')
    const rendered = `${draft.slice(0, caretOffset)}█${draft.slice(caretOffset)}`
    const pages = paginateEdit(rendered, measure, { widthPx: 568, heightPx: 216, lineHeightPx: 27 })
    const page = pages[pageOfOffset(pages, caretOffset)]

    expect(pages.length).toBeGreaterThan(1)
    expect(page.text).toContain('█')
    for (const editPage of pages) expect(measure(editPage.text, 568).lineCount).toBeLessThanOrEqual(8)
  })

  it('keeps the caret inside the 7-line edit body window and shows line range', () => {
    const lines = Array.from({ length: 20 }, (_, index) => `line-${index + 1}`)
    const draft = lines.join('\n')

    for (const targetLine of [1, 7, 8, 20]) {
      const offset = lines.slice(0, targetLine - 1).join('\n').length + (targetLine === 1 ? 0 : 1)
      const text = formatEdit(editState({ draft, cursor: { offset, line: targetLine, col: 1 } }), wrapForty)
      const screenLines = text.split('\n')
      const body = screenLines.slice(1, 8)

      expect(screenLines).toHaveLength(9)
      expect(body.some(line => line.includes('█'))).toBe(true)
      expect(screenLines[8]).toMatch(/L\d+-\d+\/20/)
    }
  })

  it('exposes wrapped edit line units for line-window rendering', () => {
    const units = editLineUnits('a'.repeat(70), measure)

    expect(units.length).toBeGreaterThan(1)
    for (const unit of units) expect(measure(unit.text, 568).lineCount).toBe(1)
  })

  it('renders the wide caret marker at the cursor offset', () => {
    expect(renderEditDraft('ab', 1, undefined)).toBe('a█b')
  })

  it('renders the selection with UI-only bracket markers and the caret on the head side', () => {
    expect(renderEditDraft('abcdef', 4, undefined, 2)).toBe('ab【cd█】ef')
    expect(renderEditDraft('abcdef', 2, undefined, 4)).toBe('ab【█cd】ef')
    expect(renderEditDraft('abcdef', 2, undefined, 2)).toBe('ab█cdef')
  })

  it('shows the conversion target boundary with corner brackets while candidates are open', () => {
    const text = formatEdit(
      editState({
        draft: '',
        composing: 'こんにちわ',
        ime: {
          mode: 'kana',
          convStyle: 'classic',
          reading: 'こんにちわ',
          pending: '',
          raw: 'konnnitiwa',
          candidates: ['今日'],
          selected: 0,
          splitLength: 3,
          lookupFailed: false,
          suggesting: false,
        },
      }),
    )

    expect(text).toContain('█[「こんに」ちわ]')
  })

  it('shows selected symbol candidates inline even without a reading', () => {
    const text = formatEdit(
      editState({
        draft: '',
        composing: '。',
        ime: {
          mode: 'kana',
          convStyle: 'classic',
          reading: '',
          pending: '',
          raw: '.',
          candidates: ['。', '．', '.'],
          selected: 1,
          splitLength: 0,
          lookupFailed: false,
          suggesting: false,
        },
      }),
    )

    expect(text).toContain('█[．]')
    expect(text).toContain('1:。 [2:．] 3:.')
  })

  it('keeps the viewport top while the cursor stays inside the window (computeStickyTop)', () => {
    const lines = Array.from({ length: 20 }, (_, index) => `line-${index + 1}`)
    const draft = lines.join('\n')
    const offsetOf = (line: number) => lines.slice(0, line - 1).join('\n').length + (line === 1 ? 0 : 1)
    const at = (line: number, scrollLine: number | null) =>
      editState({ draft, cursor: { offset: offsetOf(line), line, col: 1 }, scrollLine })

    expect(computeStickyTop(at(10, 5), wrapForty)).toBe(5) // 表示行9は窓[5..11]内 → 維持
    expect(computeStickyTop(at(6, 5), wrapForty)).toBe(5) // 表示行5=先頭行 → 維持
    expect(computeStickyTop(at(5, 5), wrapForty)).toBe(4) // 窓の上に出た → 上に追従
    expect(computeStickyTop(at(15, 5), wrapForty)).toBe(8) // 窓の下に出た → 下端に追従
    expect(computeStickyTop(at(15, null), wrapForty)).toBe(8) // 初期値null → カーソル最下行
  })

  it('moves offsets across physical G2 lines while preserving column', () => {
    expect(moveOffsetByG2Line('abc\ndef', 1, 1, wrapFive)).toBe(5)
    expect(moveOffsetByG2Line('abc\ndef', 5, -1, wrapFive)).toBe(1)
  })

  it('moves offsets across wrapped G2 line units', () => {
    expect(moveOffsetByG2Line('abcdefghij', 2, 1, wrapFive)).toBe(7)
    expect(moveOffsetByG2Line('abcdefghij', 7, -1, wrapFive)).toBe(2)
  })

  it('clamps G2 line movement at document ends and target line length', () => {
    expect(moveOffsetByG2Line('abc\nd', 1, -1, wrapFive)).toBe(1)
    expect(moveOffsetByG2Line('abc\nd', 2, 1, wrapFive)).toBe(5)
    expect(moveOffsetByG2Line('abc\nd', 5, 1, wrapFive)).toBe(5)
  })

  it('moves to an empty G2 line instead of the following line start', () => {
    expect(moveOffsetByG2Line('\nabcdef', 3, -1, wrapFive)).toBe(0)
    expect(moveOffsetByG2Line('abcdef\n', 6, 1, wrapFive)).toBe(7)
  })

  it('computes Home and End edges for the current G2 display line', () => {
    expect(g2LineEdge('abcdefghij', 7, 'home', wrapFive)).toBe(5)
    expect(g2LineEdge('abcdefghij', 7, 'end', wrapFive)).toBe(10)
    expect(g2LineEdge('abc\ndef', 5, 'home', wrapFive)).toBe(4)
    expect(g2LineEdge('abc\ndef', 5, 'end', wrapFive)).toBe(7)
  })

  it('computes the glasses render flush delay from the last flush time', () => {
    expect(renderFlushDelay(0, 120)).toBe(0)
    expect(renderFlushDelay(80, 110)).toBe(90)
    expect(renderFlushDelay(0, 1000)).toBe(0)
  })
})

describe('list glasses formatting', () => {
  it('adds a slash suffix to directory list labels', () => {
    expect(
      labelsFor([
        { label: 'a', kind: 'file', path: 'a' },
        { label: 'b', kind: 'dir', path: 'b' },
      ]),
    ).toEqual(['a', 'b/'])
  })

  it('truncates a 64-character ASCII filename to at most 63 UTF-8 bytes with an ellipsis', () => {
    const label = labelsFor([{ label: 'a'.repeat(64), kind: 'file', path: 'long.md' }])[0]

    expect(utf8ByteLength(label)).toBeLessThanOrEqual(63)
    expect(label).toMatch(/\.\.\.$/)
  })

  it('truncates a long Japanese filename without splitting UTF-8 characters', () => {
    const label = labelsFor([
      {
        label: '日本語のとても長いファイル名テスト用ノート2026-07-04.md',
        kind: 'file',
        path: 'long-ja.md',
      },
    ])[0]

    expect(utf8ByteLength(label)).toBeLessThanOrEqual(63)
    expect(label).toContain('...')
    expect(label).not.toContain('\uFFFD')
    expect(new TextDecoder('utf-8', { fatal: true }).decode(new TextEncoder().encode(label))).toBe(label)
  })

  it('leaves short list labels unchanged', () => {
    expect(labelsFor([{ label: 'short.md', kind: 'file', path: 'short.md' }])).toEqual(['short.md'])
  })

  it('keeps displayed list item labels within the compact display byte limit', () => {
    const labels = labelsFor([
      { label: 'a'.repeat(64), kind: 'file', path: 'ascii.md' },
      { label: '日本語のとても長いファイル名テスト用ノート2026-07-04.md', kind: 'file', path: 'ja.md' },
      { label: '日本語のとても長いディレクトリ名テスト用フォルダ', kind: 'dir', path: 'dir' },
      { label: 'short.md', kind: 'file', path: 'short.md' },
    ])

    for (const label of labels) expect(utf8ByteLength(label)).toBeLessThanOrEqual(63)
  })

  it('fits every list row on a single measured display line', () => {
    const row = `> ${'a'.repeat(80)}`
    const fitted = fitListRow(row, measure)

    expect(fitted.endsWith('...')).toBe(true)
    expect(measure(fitted, 568).lineCount).toBe(1)
  })

  it('fits long Japanese rows on a single measured display line', () => {
    const row = `> ${'長いファイル名'.repeat(12)}.md`
    const fitted = fitListRow(row, measure)

    expect(fitted.endsWith('...')).toBe(true)
    expect(measure(fitted, 568).lineCount).toBe(1)
  })

  it('keeps short rows untouched by the single-line fit', () => {
    expect(fitListRow('> short.md', measure)).toBe('> short.md')
  })

  it('keeps 9 physical lines even when filenames are long enough to wrap', () => {
    const longItems: ListItem[] = Array.from({ length: 7 }, (_, index) => ({
      label: `even-g2-editor-phase-c-edit-unification-scroll-ime-2026-07-04-${index + 1}.md`,
      kind: 'file',
      path: `long-${index + 1}.md`,
    }))
    const text = formatScreen(listState(longItems, { selectedIndex: 3 }))
    const lines = text.split('\n')

    expect(lines).toHaveLength(9)
    expect(lines.at(-1)).toBe('tap:open  swipe:move  double:back')
  })

  it('fits list headers, rows, and footers to one measured display line', () => {
    const pretextMeasure = createPretextMeasure()
    const longItems: ListItem[] = Array.from({ length: 7 }, (_, index) => ({
      label: `even-g2-editor-phase-c-edit-unification-scroll-ime-long-display-name-2026-07-04-${index + 1}.md`,
      kind: 'file',
      path: `research/2026-07-04/long-display-name-${index + 1}.md`,
    }))
    const state = listState(longItems, { selectedIndex: 2 })
    if (state.current.mode !== 'list') throw new Error('expected list state')
    state.current.title = 'RECENT'
    state.current.path = 'research/2026-07-04/obsidian-editor-g2-single-line-fit-with-long-heading'

    const lines = formatScreen(state).split('\n')

    expect(lines).toHaveLength(9)
    for (const line of lines) expect(pretextMeasure(line, singleLineWidthPx).lineCount).toBe(1)
    expect(lines[0]).toMatch(/\.\.\.|\(1\/1\)$/)
    expect(lines.slice(1, 8).some(line => line.endsWith('...'))).toBe(true)
  })

  it('formats empty lists as 9 lines', () => {
    const text = formatScreen(listState([]))

    expect(text.split('\n')).toHaveLength(9)
    expect(text).toContain('TREE / (1/1)')
  })

  it('formats 7 list items as 9 lines on one page', () => {
    const text = formatScreen(listState(items(7)))

    expect(text.split('\n')).toHaveLength(9)
    expect(text).toContain('TREE / (1/1)')
  })

  it('formats 8 list items as 9 lines across 7-row pages', () => {
    const text = formatScreen(listState(items(8)))

    expect(text.split('\n')).toHaveLength(9)
    expect(text).toContain('TREE / (1/2)')
    expect(text).not.toContain('note-8.md')
  })

  it('formats a 28-item list as text pages with absolute selection marker and page indicator', () => {
    const text = formatScreen(listState(items(28), { selectedIndex: 21 }))

    expect(text.split('\n')).toHaveLength(9)
    expect(text).toContain('TREE / (4/4)')
    expect(text).toContain('> note-22.md')
  })

  it('renders list screens to the glasses text renderer', async () => {
    vi.useFakeTimers()
    const text = formatScreen(listState(items(28), { selectedIndex: 21 }))
    const bridge = {
      createStartUpPageContainer: vi.fn().mockResolvedValue(0),
      textContainerUpgrade: vi.fn().mockResolvedValue(0),
    }
    const renderer = await initGlasses(bridge as never)

    const rendered = renderer.render({ kind: 'text', text })
    await vi.advanceTimersByTimeAsync(120)
    await rendered

    expect(bridge.textContainerUpgrade).toHaveBeenCalledOnce()
    expect(bridge.textContainerUpgrade.mock.calls[0][0].content).toBe(text)
  })

  it('formats Save/Discard confirmation with its selected action', () => {
    const state: AppState = {
      current: { mode: 'confirm-save', title: 'Save changes?', edit: editState({ dirty: true }), selected: 0 },
      stack: [],
      exitRequested: false,
    }

    const text = formatScreen(state)

    expect(text).toContain('Save changes?')
    expect(text).toContain('> [Save]')
    expect(text).toContain('Discard')
    expect(text).toContain('double:cancel')
  })
})

function editState(overrides: Partial<EditState> = {}): EditState {
  return {
    mode: 'edit',
    title: 'note.md',
    path: 'note.md',
    baseMtime: 1,
    draft: 'body',
    dirty: false,
    cursor: { offset: 0, line: 1, col: 1 },
    status: 'editing',
    scrollLine: null,
    ime: { mode: 'direct', convStyle: 'classic', reading: '', pending: '', raw: '', candidates: null, selected: 0, splitLength: 0, lookupFailed: false, suggesting: false },
    ...overrides,
  }
}

function listState(items: ListItem[], overrides: { selectedIndex?: number } = {}): AppState {
  return {
    current: {
      mode: 'list',
      kind: 'tree',
      title: 'TREE',
      path: '',
      items,
      selectedIndex: overrides.selectedIndex ?? 0,
    },
    stack: [],
    exitRequested: false,
  }
}

function items(count: number): ListItem[] {
  return Array.from({ length: count }, (_, index) => ({
    label: `note-${index + 1}.md`,
    kind: 'file',
    path: `note-${index + 1}.md`,
  }))
}

function labelsFor(items: ListItem[], overrides: { selectedIndex?: number } = {}): string[] {
  const state = listState(items, overrides).current
  if (state.mode !== 'list') throw new Error('expected list state')
  return formatScreen({ current: state, stack: [], exitRequested: false })
    .split('\n')
    .slice(1, 1 + items.length)
    .map(line => line.slice(2))
}

function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength
}
