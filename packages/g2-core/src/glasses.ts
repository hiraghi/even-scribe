import {
  CreateStartUpPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  type EvenAppBridge,
} from '@evenrealities/even_hub_sdk'
import { createPretextMeasure, type MeasureFn, type PaginateBox } from './paginate'
import type { AppState, ConfirmDeleteState, ConfirmState, EditState, Extension, ListState, NameInputState, ScreenBase } from './state'

const TEXT_CONTAINER_ID = 1
const TEXT_CONTAINER_NAME = 'main'
const MAX_CONTENT_LENGTH = 2000
export const LIST_BODY_ROWS = 7
const LABEL_LIMIT = 64
const LIST_ITEM_NAME_LIMIT_BYTES = 63
const TRUNCATION_MARKER = '...'
// 7 body lines: header + 7 + footer = 9 total lines (same as list mode) so the
// mirror text fits the glasses container without firmware-side scrolling.
// widthPx: the 576px container loses 16px to padding on the device — lines
// measured at 561-565px wrap on the simulator while 559px fits, so the
// effective text width is 560px, not 576-2*paddingLength=568.
export const EDIT_BODY_BOX: PaginateBox = { widthPx: 560, heightPx: 189, lineHeightPx: 27 }
export const SINGLE_LINE_SAFETY_PX = 12
export const SINGLE_LINE_WIDTH_PX = EDIT_BODY_BOX.widthPx - SINGLE_LINE_SAFETY_PX
const TEXT_ENCODER = new TextEncoder()

export interface GlassesRenderer {
  render(screen: GlassesScreen): Promise<void>
}

export type GlassesScreen = { kind: 'text'; text: string }

export async function initGlasses(bridge: EvenAppBridge): Promise<GlassesRenderer> {
  const main = buildTextContainer('Loading...')

  const created = await bridge.createStartUpPageContainer(
    new CreateStartUpPageContainer({ containerTotalNum: 1, textObject: [main] }),
  )
  if (created !== 0) {
    // Non-zero typically means the container already exists (e.g. after a page
    // reload while the simulator/glasses kept the previous session's container).
    // The renderer below updates via textContainerUpgrade, which still works
    // against the existing container, so keep going instead of dying.
    console.warn(`createStartUpPageContainer returned ${created}; reusing existing container`)
  }

  return new DebouncedGlassesRenderer(bridge)
}

export function buildTextContainer(content: string): TextContainerProperty {
  return new TextContainerProperty({
    xPosition: 0,
    yPosition: 0,
    width: 576,
    height: 288,
    borderWidth: 0,
    paddingLength: 4,
    containerID: TEXT_CONTAINER_ID,
    containerName: TEXT_CONTAINER_NAME,
    content,
    isEventCapture: 1,
  })
}

function allListItemLabels(state: ListState): string[] {
  return state.items.map(item => {
    const suffix = item.kind === 'dir' ? '/' : ''
    return truncateListItemLabel(item.label, suffix)
  })
}

export function formatScreen<X extends ScreenBase = never>(state: AppState<X>, ext?: Extension<X>): string {
  const current = state.current as ScreenBase
  if (current.mode === 'edit') return formatEdit(state.current as EditState)
  if (current.mode === 'confirm-save') return formatConfirmSave(state.current as ConfirmState)
  if (current.mode === 'confirm-delete') return formatConfirmDelete(state.current as ConfirmDeleteState)
  if (current.mode === 'name-input') return formatNameInput(state.current as NameInputState)
  if (current.mode !== 'list') return ext?.formatScreen?.(state.current as X) ?? ''

  return formatList(state.current as ListState)
}

function formatConfirmSave(state: ConfirmState, measure: MeasureFn = createPretextMeasure()): string {
  const save = state.selected === 0 ? '> [Save]' : '  [Save]'
  const discard = state.selected === 1 ? '> Discard' : '  Discard'
  return fitScreen(state.title, `${state.edit.title}\n\n${save}\n${discard}`, 'swipe:choose  tap:confirm  double:cancel', measure)
}

function formatConfirmDelete(state: ConfirmDeleteState, measure: MeasureFn = createPretextMeasure()): string {
  const del = state.selected === 0 ? '> [Delete]' : '  [Delete]'
  const cancel = state.selected === 1 ? '> Cancel' : '  Cancel'
  const target = `${state.target.label}${state.target.isDir ? '/' : ''}`
  return fitScreen(state.title, `${target}\n\n${del}\n${cancel}`, 'swipe:choose  tap:confirm  double:cancel', measure)
}

function formatNameInput(state: NameInputState, measure: MeasureFn = createPretextMeasure()): string {
  const composing = imeDisplayComposing(state)
  const body = renderEditDraft(state.buffer, state.cursor.offset, composing, state.selAnchor)
  const kanaMark = state.ime.mode === 'kana' ? 'あ' : 'A'
  const footer = state.ime.candidates
    ? formatImeCandidates(state.ime.candidates, state.ime.selected, measure)
    : composing
      ? `[${kanaMark}] IME: ${composing}${state.ime.lookupFailed ? ' !err' : ''}`
      : `[${kanaMark}] Enter:confirm  Esc:cancel`
  return fitScreen(state.label, body, footer, measure)
}

export interface EditPage {
  text: string
  start: number
  end: number
}

// 候補表示中は「変換対象」と未変換の読みの境界を G2 上で可視化する。
// 例: 読み「こんにちわ」で splitLength=4 →「こんにち」わ(←/→で境界が動いて見える)
function imeDisplayComposing(state: EditState | NameInputState): string | undefined {
  const ime = state.ime
  if (ime.candidates !== null && ime.reading === '' && ime.pending === '') return ime.candidates[ime.selected] ?? ime.candidates[0]
  const composing = state.mode === 'name-input' ? `${ime.reading}${ime.pending}` || undefined : state.composing
  if (!composing) return composing
  if (ime.candidates === null) return composing
  if (ime.suggesting) return composing
  const len = ime.splitLength > 0 ? ime.splitLength : ime.reading.length
  const target = ime.reading.slice(0, len)
  const rest = ime.reading.slice(len) + ime.pending
  return `「${target}」${rest}`
}

export function formatEdit(state: EditState, measure: MeasureFn = createPretextMeasure()): string {
  const rendered = renderEditDraft(state.draft, state.cursor.offset, imeDisplayComposing(state), state.selAnchor)
  const units = editLineUnits(rendered, measure)
  const { cursorLine, totalLines } = editMirrorInfo(state, measure)
  const bodyRows = editBodyRows(state)
  const top = effectiveTopLine(state.scrollLine, cursorLine, totalLines, bodyRows)
  const status = editStatus(state)
  const dirty = state.dirty ? '*' : ''
  const kanaMark = state.ime.mode === 'kana' ? 'あ' : 'A'
  const trailing = [status, dirty].filter(Boolean).join(' ')
  const hint = `[${kanaMark}]Click:close Double:save${trailing ? ` ${trailing}` : ''}`
  const footer = state.ime.candidates
    ? formatImeCandidates(state.ime.candidates, state.ime.selected, measure)
    : state.composing
      ? `[${kanaMark}] IME: ${state.composing}${state.ime.lookupFailed ? ' !err' : ''}`
      : hint

  return fitScreen(
    `EDIT ${compactPath(state.path)} Ln ${cursorLine + 1}/${totalLines},Col ${state.cursor.col}`.trim(),
    lineWindowText(units, top, bodyRows),
    footer,
    measure,
  )
}

export function editMirrorInfo(
  state: EditState,
  measure: MeasureFn = createPretextMeasure(),
): { cursorLine: number; totalLines: number } {
  const rendered = renderEditDraft(state.draft, state.cursor.offset, imeDisplayComposing(state), state.selAnchor)
  const units = editLineUnits(rendered, measure)
  return { cursorLine: lineOfOffset(units, Math.min(state.cursor.offset, rendered.length)), totalLines: units.length }
}

// カーソル移動後のビューポート先頭行(sticky)。前回の scrollLine を保持し、カーソルが
// 窓外に出た時だけ最小移動で追従する — 同一画面内の移動ではスクロールしない。
export function computeStickyTop(state: EditState, measure: MeasureFn = createPretextMeasure()): number {
  const { cursorLine, totalLines } = editMirrorInfo(state, measure)
  const bodyRows = editBodyRows(state)
  const maxTop = Math.max(0, totalLines - bodyRows)
  const follow = clamp(cursorLine - bodyRows + 1, 0, maxTop)
  const base = state.scrollLine !== null ? clamp(state.scrollLine, 0, maxTop) : follow
  if (cursorLine < base) return clamp(cursorLine, 0, maxTop)
  if (cursorLine >= base + bodyRows) return follow
  return base
}

// G2 本体/リング操作によるページ送りのビューポート先頭行。物理キーボードの矢印
// (カーソル移動)とは別系統で、カーソルは動かさず現在の窓を 1 画面分(bodyRows)ずらす。
export function pageScrollTop(state: EditState, delta: number, measure: MeasureFn = createPretextMeasure()): number {
  const { cursorLine, totalLines } = editMirrorInfo(state, measure)
  const bodyRows = editBodyRows(state)
  const maxTop = Math.max(0, totalLines - bodyRows)
  const currentTop = effectiveTopLine(state.scrollLine, cursorLine, totalLines, bodyRows)
  return clamp(currentTop + delta * bodyRows, 0, maxTop)
}

export function pageOfOffset(pages: EditPage[], offset: number): number {
  if (pages.length === 0) return 0
  const bounded = clamp(offset, 0, pages.at(-1)?.end ?? 0)
  const exact = pages.findIndex(page => bounded >= page.start && bounded < page.end)
  if (exact >= 0) return exact
  return pages.length - 1
}

function formatList(state: ListState, measure: MeasureFn = createPretextMeasure()): string {
  const selectedPage = Math.floor(state.selectedIndex / LIST_BODY_ROWS)
  const start = selectedPage * LIST_BODY_ROWS
  const visible = allListItemLabels(state).slice(start, start + LIST_BODY_ROWS)
  const totalPages = Math.max(1, Math.ceil(Math.max(1, state.items.length) / LIST_BODY_ROWS))
  const lines = visible.map((label, offset) => {
    const index = start + offset
    const marker = index === state.selectedIndex ? '>' : ' '
    return fitListRow(`${marker} ${label}`, measure)
  })

  while (lines.length < LIST_BODY_ROWS) lines.push('')

  return [
    fitSingleLine(`${state.title} ${compactPath(state.path)} (${selectedPage + 1}/${totalPages})`.trim(), measure),
    ...lines,
    fitSingleLine('tap:open  swipe:move  double:back', measure),
  ].join('\n')
}

// Metadata and list rows must stay on a single display line: wrapping grows the
// body past 7 lines and pushes content down or off the 288px container.
export function fitSingleLine(line: string, measure: MeasureFn = createPretextMeasure()): string {
  if (measuredLines(line, SINGLE_LINE_WIDTH_PX, measure) <= 1) return line

  let low = 0
  let high = line.length
  let best = 0

  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    if (measuredLines(`${line.slice(0, mid)}${TRUNCATION_MARKER}`, SINGLE_LINE_WIDTH_PX, measure) <= 1) {
      best = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }

  return `${line.slice(0, best)}${TRUNCATION_MARKER}`
}

export function fitListRow(row: string, measure: MeasureFn = createPretextMeasure()): string {
  return fitSingleLine(row, measure)
}

class DebouncedGlassesRenderer implements GlassesRenderer {
  private currentScreen: GlassesScreen = { kind: 'text', text: '' }
  private lastRender = ''
  private renderTimer: number | null = null
  private lastFlushAt = 0
  private writeChain: Promise<void> = Promise.resolve()
  private resolvers: Array<() => void> = []

  constructor(private readonly bridge: EvenAppBridge) {}

  render(screen: GlassesScreen): Promise<void> {
    this.currentScreen = { kind: 'text', text: screen.text.slice(0, MAX_CONTENT_LENGTH) }

    if (this.isCurrentRenderFlushed() && this.renderTimer === null) {
      return this.writeChain
    }

    const done = new Promise<void>(resolve => {
      this.resolvers.push(resolve)
    })

    if (this.renderTimer === null) {
      this.renderTimer = globalThis.setTimeout(() => {
        this.renderTimer = null
        this.lastFlushAt = Date.now()
        const screen = this.currentScreen
        if (this.isScreenFlushed(screen)) {
          this.resolvePending()
          return
        }

        this.writeChain = this.writeChain
          .then(() => this.flushScreen(screen))
          .then(() => undefined)
          .finally(() => this.resolvePending())
      }, renderFlushDelay(this.lastFlushAt, Date.now()))
    }

    return done
  }

  private isCurrentRenderFlushed(): boolean {
    return this.isScreenFlushed(this.currentScreen)
  }

  private isScreenFlushed(screen: GlassesScreen): boolean {
    return screen.text === this.lastRender
  }

  private async flushScreen(screen: GlassesScreen): Promise<void> {
    await this.bridge.textContainerUpgrade(
      new TextContainerUpgrade({
        containerID: TEXT_CONTAINER_ID,
        containerName: TEXT_CONTAINER_NAME,
        content: screen.text,
      }),
    )
    this.lastRender = screen.text
  }

  private resolvePending() {
    const pending = this.resolvers
    this.resolvers = []
    for (const resolve of pending) resolve()
  }
}

function fitScreen(header: string, body: string, footer: string, measure: MeasureFn): string {
  const footerLines = footer.split('\n').map(line => fitSingleLine(line, measure))
  return `${fitSingleLine(truncateLine(header), measure)}\n${body.slice(0, 1700)}\n${footerLines.join('\n')}`
}

export function renderEditDraft(draft: string, offset: number, composing: string | undefined, selAnchor?: number): string {
  const safeOffset = clamp(offset, 0, draft.length)
  // 選択範囲は G2 では装飾不可のため UI 専用の [] マーカーで示す(composing 中は
  // 変換表示を優先 — 確定時に選択範囲が置換される)。█は選択の head 側に置く。
  // カーソルは █(U+2588 FULL BLOCK)。advance は ▌(U+258C) と同一 20px なので折返しは
  // 変わらないが、インクが advance 全体を埋めるため「後ろに半角スペースが入る」見えを消す。
  const anchor = selAnchor === undefined ? safeOffset : clamp(selAnchor, 0, draft.length)
  if (!composing && anchor !== safeOffset) {
    const start = Math.min(anchor, safeOffset)
    const end = Math.max(anchor, safeOffset)
    const selected = draft.slice(start, end)
    const inner = safeOffset === start ? `【█${selected}】` : `【${selected}█】`
    return `${draft.slice(0, start)}${inner}${draft.slice(end)}`
  }
  const pending = composing ? `[${composing}]` : ''
  return `${draft.slice(0, safeOffset)}█${pending}${draft.slice(safeOffset)}`
}

export function renderFlushDelay(lastFlushAt: number, now: number): number {
  return Math.max(0, 120 - (now - lastFlushAt))
}

export function paginateEdit(text: string, measure: MeasureFn = createPretextMeasure(), box = EDIT_BODY_BOX): EditPage[] {
  const maxLines = maxLinesFor(box)
  const units = editLineUnits(text, measure, box)
  const pages: EditPage[] = []
  let current: EditLineUnit[] = []

  for (const unit of units) {
    if (current.length > 0 && current.length >= maxLines) {
      pages.push(createEditPage(current))
      current = []
    }

    current.push(unit)
  }

  if (current.length > 0) pages.push(createEditPage(current))
  if (pages.length === 0) pages.push({ text: '', start: 0, end: 0 })
  return pages
}

export interface EditLineUnit {
  text: string
  start: number
  end: number
}

export function editLineUnits(text: string, measure: MeasureFn = createPretextMeasure(), box = EDIT_BODY_BOX): EditLineUnit[] {
  const physical = physicalLines(text)
  const units: EditLineUnit[] = []

  for (const line of physical) {
    if (line.text.length === 0 || measuredLines(line.text, box.widthPx, measure) <= 1) {
      units.push(line)
      continue
    }

    units.push(...splitLongEditLine(line, box.widthPx, measure))
  }

  if (units.length === 0) units.push({ text: '', start: 0, end: 0 })
  return units
}

export function moveOffsetByG2Line(text: string, offset: number, delta: number, measure: MeasureFn = createPretextMeasure()): number {
  const units = editLineUnits(text, measure)
  const currentLine = lineOfOffset(units, offset)
  const targetLine = clamp(currentLine + delta, 0, Math.max(0, units.length - 1))
  const current = units[currentLine] ?? { text: '', start: 0, end: 0 }
  const target = units[targetLine] ?? current
  const column = clamp(offset - current.start, 0, current.text.length)
  return clamp(target.start + Math.min(column, target.text.length), 0, text.length)
}

export function g2LineEdge(text: string, offset: number, edge: 'home' | 'end', measure: MeasureFn = createPretextMeasure()): number {
  const units = editLineUnits(text, measure)
  const line = units[lineOfOffset(units, offset)] ?? { text: '', start: 0, end: 0 }
  return edge === 'home' ? line.start : clamp(line.start + line.text.length, 0, text.length)
}

function physicalLines(text: string): Array<{ text: string; start: number; end: number }> {
  if (text.length === 0) return [{ text: '', start: 0, end: 0 }]

  const lines: Array<{ text: string; start: number; end: number }> = []
  let start = 0

  while (start < text.length) {
    const newline = text.indexOf('\n', start)
    if (newline === -1) {
      lines.push({ text: text.slice(start), start, end: text.length })
      break
    }

    lines.push({ text: text.slice(start, newline), start, end: newline + 1 })
    start = newline + 1
  }

  if (text.endsWith('\n')) lines.push({ text: '', start: text.length, end: text.length })
  return lines
}

function splitLongEditLine(
  line: { text: string; start: number; end: number },
  widthPx: number,
  measure: MeasureFn,
): EditLineUnit[] {
  const units: EditLineUnit[] = []
  let localStart = 0

  while (localStart < line.text.length) {
    const remaining = line.text.slice(localStart)
    const length = fittingPrefixLength(remaining, 1, widthPx, measure)
    const chunk = remaining.slice(0, length)
    const isLast = localStart + length >= line.text.length
    units.push({
      text: chunk,
      start: line.start + localStart,
      end: isLast ? line.end : line.start + localStart + length,
    })
    localStart += length
  }

  return units
}

function fittingPrefixLength(text: string, maxLines: number, widthPx: number, measure: MeasureFn): number {
  let low = 1
  let high = text.length
  let best = 1

  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    if (measuredLines(text.slice(0, mid), widthPx, measure) <= maxLines) {
      best = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }

  return best
}

function createEditPage(units: EditLineUnit[]): EditPage {
  return {
    text: units.map(unit => unit.text).join('\n'),
    start: units[0].start,
    end: units.at(-1)?.end ?? units[0].end,
  }
}

function lineWindowText(units: EditLineUnit[], top: number, rows: number): string {
  const lines = units.slice(top, top + rows).map(unit => unit.text)
  while (lines.length < rows) lines.push('')
  return lines.join('\n')
}

function effectiveTopLine(scrollLine: number | null, cursorLine: number, totalLines: number, bodyRows: number): number {
  const maxTop = Math.max(0, totalLines - bodyRows)
  if (scrollLine !== null) return clamp(scrollLine, 0, maxTop)
  return clamp(cursorLine - bodyRows + 1, 0, maxTop)
}

function lineOfOffset(units: EditLineUnit[], offset: number): number {
  if (units.length === 0) return 0
  const bounded = clamp(offset, 0, units.at(-1)?.end ?? 0)
  const exact = units.findIndex(unit => bounded >= unit.start && bounded < unit.end)
  if (exact >= 0) return exact
  return units.length - 1
}

function measuredLines(text: string, widthPx: number, measure: MeasureFn): number {
  return Math.max(1, measure(text, widthPx).lineCount)
}

function maxLinesFor(box: PaginateBox): number {
  return Math.max(1, Math.floor(box.heightPx / box.lineHeightPx))
}

function editStatus(state: EditState): string {
  if (state.status === 'conflict') return '!conflict'
  if (state.status === 'error') return '!error'
  if (state.status === 'saving') return 'saving'
  return state.isNew ? 'new' : ''
}

function formatImeCandidates(candidates: string[], selected: number, measure: MeasureFn): string {
  const visible = candidates.slice(0, 15)
  const pages: number[][] = []
  let page: number[] = []

  for (let index = 0; index < visible.length; index += 1) {
    const next = [...page, index]
    if (page.length > 0 && !candidatePageFits(visible, next, measure)) {
      pages.push(page)
      page = [index]
    } else {
      page = next
    }
  }
  if (page.length > 0) pages.push(page)
  if (pages.length === 0) return ''

  const selectedPage = Math.max(0, pages.findIndex(indices => indices.includes(selected)))
  const pageIndex = selectedPage >= 0 ? selectedPage : 0
  const indices = pages[pageIndex]
  const prefix = pageIndex > 0 ? '‹ ' : ''
  const suffix = pageIndex < pages.length - 1 ? ' ›' : ''
  const parts = indices.map(index => {
    const label = `${index + 1}:${visible[index]}`
    return index === selected ? `[${label}]` : label
  })
  const line = `${prefix}${parts.join(' ')}${suffix}`
  return measuredLines(line, SINGLE_LINE_WIDTH_PX, measure) <= 1 ? line : fitCandidatePage(parts, prefix, suffix, measure)
}

function candidatePageFits(candidates: string[], indices: number[], measure: MeasureFn): boolean {
  const parts = indices.map(index => `[${index + 1}:${candidates[index]}]`)
  return measuredLines(`‹ ${parts.join(' ')} ›`, SINGLE_LINE_WIDTH_PX, measure) <= 1
}

function fitCandidatePage(parts: string[], prefix: string, suffix: string, measure: MeasureFn): string {
  const first = parts[0] ?? ''
  let low = 0
  let high = first.length
  let best = ''
  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const candidate = mid < first.length ? `${first.slice(0, mid)}...` : first
    if (measuredLines(`${prefix}${candidate}${suffix}`, SINGLE_LINE_WIDTH_PX, measure) <= 1) {
      best = candidate
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  return `${prefix}${best}${suffix}`
}

function editBodyRows(_state: EditState): number {
  return LIST_BODY_ROWS
}

function truncateListItemLabel(label: string, suffix: string): string {
  const full = `${label}${suffix}`
  if (utf8ByteLength(full) <= LIST_ITEM_NAME_LIMIT_BYTES) return full

  const suffixBytes = utf8ByteLength(suffix)
  const markerBytes = utf8ByteLength(TRUNCATION_MARKER)
  const labelBudget = Math.max(0, LIST_ITEM_NAME_LIMIT_BYTES - suffixBytes - markerBytes)
  let truncated = ''

  for (const char of label) {
    if (utf8ByteLength(`${truncated}${char}`) > labelBudget) break
    truncated += char
  }

  return `${truncated}${TRUNCATION_MARKER}${suffix}`
}

function truncateLine(line: string): string {
  return line.length <= LABEL_LIMIT ? line : `${line.slice(0, LABEL_LIMIT - 3)}...`
}

function utf8ByteLength(text: string): number {
  return TEXT_ENCODER.encode(text).byteLength
}

function compactPath(path: string): string {
  if (!path) return '/'
  return truncateLine(path)
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.min(max, Math.max(min, value))
}
