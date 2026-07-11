import {
  applyCandidates,
  cancelIme as cancelImeState,
  confirmImeCandidate as confirmImeCandidateState,
  createIme,
  imeComposing,
  moveImeSelection as moveImeSelectionState,
  reduceImeKey,
  type ImeLearning,
  type ImeState,
} from '@eveng2/jp-ime'
import { computeStickyTop } from './glasses'
import type { VaultEntry } from './storage'

export type ListKind = 'recent' | 'tree'

export interface ListItem {
  label: string
  kind: 'browse-root' | 'dir' | 'file' | (string & {})
  path: string
  selectEffect?: Effect
}

export interface ListState {
  mode: 'list'
  kind: ListKind
  title: string
  path: string
  items: ListItem[]
  selectedIndex: number
  exitRequested?: false
}

export interface EditState {
  mode: 'edit'
  title: string
  path: string
  baseMtime: number
  draft: string
  dirty: boolean
  cursor: { offset: number; line: number; col: number }
  // 選択範囲の固定端(anchor)。cursor.offset が可動端(head)。undefined = 選択なし
  selAnchor?: number
  composing?: string
  status: 'editing' | 'saving' | 'conflict' | 'error' | 'confirm-discard'
  message?: string
  scrollLine: number | null
  isNew?: boolean
  ime: ImeState
}

export interface ScreenBase {
  mode: string
}

export type ScreenState = ListState | EditState

export interface AppState<X extends ScreenBase = never> {
  current: ScreenState | X
  stack: Array<ScreenState | X>
  exitRequested: boolean
}

export type AppEvent =
  | { type: 'scrollUp' | 'scrollDown' | 'doubleClick' }
  | { type: 'click'; index?: number }
  | { type: 'listSelect'; index: number }
  | { type: 'loadedRecent'; entries: VaultEntry[] }
  | { type: 'loadedTree'; path: string; entries: VaultEntry[] }
  | { type: 'loadedFile'; path: string; rawContent: string; mtime: number }
  | { type: 'startNewFile'; path: string }
  | { type: 'restoreDraft'; path: string; baseMtime: number; draft: string; cursor: EditState['cursor']; isNew?: boolean }
  | { type: 'editInput'; draft: string; cursor: EditState['cursor']; composing?: string; selAnchor?: number }
  | { type: 'imeToggle' }
  | { type: 'imeSetMode'; mode: 'direct' | 'kana' }
  | { type: 'imeSetConvStyle'; convStyle: ImeState['convStyle'] }
  | { type: 'imeKey'; key: string }
  | { type: 'imeCandidates'; text: string; candidates: string[]; error?: boolean }
  | { type: 'osImeDetected' }
  | { type: 'app'; name: string; payload?: unknown }
  | { type: 'requestSave' }
  | { type: 'saveDone'; mtime: number }
  | { type: 'saveFailed'; status: 'conflict' | 'error'; message: string }
  | { type: 'discardEdit' }

export type Effect =
  | { kind: 'openTree'; path: string }
  | { kind: 'openFile'; path: string }
  | { kind: 'openRecent' }
  | { kind: 'saveFile'; path: string; content: string; baseMtime: number }
  | { kind: 'createFile'; path: string; content: string }
  | { kind: 'imeLookup'; text: string; immediate?: boolean }
  | { kind: 'imeLearn'; reading: string; candidate: string }
  | { kind: 'batch'; effects: Effect[] }
  | { kind: 'app'; name: string; payload?: unknown }
  | { kind: 'none' }
  | { kind: 'exit' }

export interface ReduceResult<X extends ScreenBase = never> {
  state: AppState<X>
  effect: Effect
}

export interface Extension<X extends ScreenBase = never> {
  recentMenuItems?: ListItem[]
  reduce?(state: AppState<X>, ev: AppEvent): ReduceResult<X> | null
  formatScreen?(screen: X): string | null
}

export function createInitialState<X extends ScreenBase = never>(): AppState<X> {
  return {
    current: createRecentList([]),
    stack: [],
    exitRequested: false,
  }
}

export function createRecentList(entries: VaultEntry[], extraItems: ListItem[] = []): ListState {
  return {
    mode: 'list',
    kind: 'recent',
    title: 'RECENT',
    path: '',
    items: [
      { label: '[Browse vault...]', kind: 'browse-root', path: '' },
      ...extraItems,
      ...entries.map(entryToListItem).filter(item => item.kind === 'file' && isMarkdownPath(item.path)),
    ],
    selectedIndex: 0,
  }
}

export function createTreeList(path: string, entries: VaultEntry[]): ListState {
  return {
    mode: 'list',
    kind: 'tree',
    title: 'TREE',
    path,
    items: entries.map(entryToListItem).filter(item => item.kind !== 'file' || isMarkdownPath(item.path)),
    selectedIndex: 0,
  }
}

export function reduce<X extends ScreenBase = never>(state: AppState<X>, ev: AppEvent, ext?: Extension<X>): ReduceResult<X> {
  const handled = ext?.reduce?.(state, ev)
  if (handled) return handled

  if (ev.type === 'loadedRecent') {
    return { state: { current: createRecentList(ev.entries, ext?.recentMenuItems), stack: [], exitRequested: false }, effect: { kind: 'none' } }
  }

  if (ev.type === 'loadedTree') {
    const next = createTreeList(ev.path, ev.entries)
    return { state: { ...state, current: next, exitRequested: false }, effect: { kind: 'none' } }
  }

  if (ev.type === 'loadedFile') {
    const next = createEdit(ev.path, ev.mtime, ev.rawContent, { offset: 0, line: 1, col: 1 }, false)
    return { state: { ...state, current: next, exitRequested: false }, effect: { kind: 'none' } }
  }

  if (ev.type === 'startNewFile') {
    return {
      state: {
        ...pushCurrent(state),
        current: createEdit(ev.path, 0, '', { offset: 0, line: 1, col: 1 }, true),
      },
      effect: { kind: 'none' },
    }
  }

  if (ev.type === 'restoreDraft') {
    return {
      state: {
        ...pushCurrent(state),
        current: {
          ...createEdit(ev.path, ev.baseMtime, ev.draft, ev.cursor, ev.isNew ?? ev.baseMtime === 0),
          dirty: true,
          message: 'Restored draft',
        },
      },
      effect: { kind: 'none' },
    }
  }

  if (ev.type === 'editInput') return editInput(state, ev)

  if (ev.type === 'imeToggle') return imeToggle(state)

  if (ev.type === 'imeSetMode') return imeSetMode(state, ev.mode)

  if (ev.type === 'imeSetConvStyle') return imeSetConvStyle(state, ev.convStyle)

  if (ev.type === 'imeKey') return imeKey(state, ev.key)

  if (ev.type === 'imeCandidates') return imeCandidates(state, ev)

  if (ev.type === 'osImeDetected') return osImeDetected(state)

  if (ev.type === 'requestSave') return requestSave(state)

  if (ev.type === 'saveDone') return saveDone(state, ev.mtime)

  if (ev.type === 'saveFailed') return saveFailed(state, ev.status, ev.message)

  if (ev.type === 'discardEdit') return discardEdit(state)

  if (
    state.current.mode === 'edit' &&
    (state.current as EditState).ime.candidates !== null &&
    (!(state.current as EditState).ime.suggesting || (state.current as EditState).ime.convStyle === 'live')
  ) {
    if (ev.type === 'scrollUp' || ev.type === 'scrollDown') {
      return { state: moveImeSelection(state, ev.type === 'scrollDown' ? 1 : -1), effect: { kind: 'none' } }
    }
    if (ev.type === 'click') return confirmImeCandidate(state)
    if (ev.type === 'doubleClick') return cancelIme(state)
  }

  if (ev.type === 'scrollUp' || ev.type === 'scrollDown') {
    return { state: scroll(state, ev.type === 'scrollDown' ? 1 : -1), effect: { kind: 'none' } }
  }

  if (ev.type === 'listSelect') {
    return { state: listSelect(state, ev.index), effect: { kind: 'none' } }
  }

  if (ev.type === 'doubleClick') {
    return doubleClick(state)
  }

  if (ev.type === 'click') {
    return click(state, ev.index)
  }

  return { state, effect: { kind: 'none' } }
}

function scroll(state: AppState<any>, delta: number): AppState<any> {
  const current = state.current
  if (current.mode === 'edit') {
    const cursor = moveCursorByLogicalLine(current.draft, current.cursor, delta)
    if (cursor.offset === current.cursor.offset && cursor.line === current.cursor.line && cursor.col === current.cursor.col) return state
    const next: EditState = { ...current, cursor }
    return { ...state, current: { ...next, scrollLine: computeStickyTop(next) } }
  }

  if (current.mode !== 'list') return state

  return {
    ...state,
    current: {
      ...current,
      selectedIndex: clamp(current.selectedIndex + delta, 0, Math.max(0, current.items.length - 1)),
    },
  }
}

function listSelect(state: AppState<any>, index: number): AppState<any> {
  const current = state.current
  if (current.mode !== 'list') return state

  return {
    ...state,
    current: {
      ...current,
      selectedIndex: clamp(index, 0, Math.max(0, current.items.length - 1)),
    },
  }
}

function click(state: AppState<any>, index?: number): ReduceResult<any> {
  const current = state.current
  if (current.mode === 'edit') return discardEdit(state)
  if (current.mode !== 'list') return { state, effect: { kind: 'none' } }

  void index
  const selectedIndex = current.selectedIndex
  const selectedState = selectedIndex === current.selectedIndex ? state : { ...state, current: { ...current, selectedIndex } }
  const selected = current.items[selectedIndex]
  if (!selected) return { state, effect: { kind: 'none' } }

  if (selected.selectEffect) {
    return { state: selectedState, effect: selected.selectEffect }
  }

  if (selected.kind === 'browse-root' || selected.kind === 'dir') {
    return { state: pushCurrent(selectedState), effect: { kind: 'openTree', path: selected.path } }
  }

  if (!isMarkdownPath(selected.path)) return { state: selectedState, effect: { kind: 'none' } }

  return { state: pushCurrent(selectedState), effect: { kind: 'openFile', path: selected.path } }
}

function doubleClick(state: AppState<any>): ReduceResult<any> {
  if (state.current.mode === 'edit') return requestSave(state)

  if (state.current.mode === 'list' && state.current.kind === 'tree') {
    if (state.current.path !== '') {
      return { state, effect: { kind: 'openTree', path: parentPath(state.current.path) } }
    }

    const previous = state.stack.at(-1)
    if (previous) {
      return {
        state: { current: previous, stack: state.stack.slice(0, -1), exitRequested: false },
        effect: { kind: 'none' },
      }
    }

    return { state, effect: { kind: 'openRecent' } }
  }

  const previous = state.stack.at(-1)
  if (previous) {
    return {
      state: { current: previous, stack: state.stack.slice(0, -1), exitRequested: false },
      effect: { kind: 'none' },
    }
  }

  if (state.current.mode === 'list' && state.current.kind === 'recent') {
    // Do NOT exit: shutDownPageContainer blanks the glasses display with no in-app
    // recovery path (simulator drops the active event container). Refresh instead.
    return { state, effect: { kind: 'openRecent' } }
  }

  return { state, effect: { kind: 'none' } }
}

function editInput(state: AppState<any>, ev: Extract<AppEvent, { type: 'editInput' }>): { state: AppState<any>; effect: Effect } {
  const current = state.current
  if (current.mode !== 'edit') return { state, effect: { kind: 'none' } }

  const next: EditState = {
    ...current,
    draft: ev.draft,
    cursor: ev.cursor,
    selAnchor: ev.selAnchor,
    composing: ev.composing,
    dirty: current.dirty || ev.draft !== current.draft,
    status: current.status === 'saving' ? current.status : 'editing',
    message: undefined,
  }
  return {
    state: { ...state, current: { ...next, scrollLine: computeStickyTop(next) } },
    effect: { kind: 'none' },
  }
}

function imeToggle(state: AppState<any>): { state: AppState<any>; effect: Effect } {
  const current = state.current
  if (current.mode !== 'edit') return { state, effect: { kind: 'none' } }
  const mode = current.ime.mode === 'direct' ? 'kana' : 'direct'
  return imeSetMode(state, mode)
}

function imeSetMode(state: AppState<any>, mode: ImeState['mode']): { state: AppState<any>; effect: Effect } {
  const current = state.current
  if (current.mode !== 'edit') return { state, effect: { kind: 'none' } }
  if (current.ime.mode === mode) return { state, effect: { kind: 'none' } }
  // 未確定の読み/ローマ字を捨てず、確定してからモードを切り替える
  const pendingText = imeComposing(current.ime)
  if (pendingText) return commitImeText(state, pendingText, createIme(mode, current.ime.convStyle))
  return {
    state: { ...state, current: { ...current, ime: createIme(mode, current.ime.convStyle), composing: undefined, message: undefined } },
    effect: { kind: 'none' },
  }
}

function imeSetConvStyle(state: AppState<any>, convStyle: ImeState['convStyle']): { state: AppState<any>; effect: Effect } {
  const current = state.current
  if (current.mode !== 'edit' || current.ime.convStyle === convStyle) return { state, effect: { kind: 'none' } }
  const pendingText = imeComposing(current.ime)
  if (pendingText) return commitImeText(state, pendingText, createIme(current.ime.mode, convStyle))
  return {
    state: { ...state, current: { ...current, ime: createIme(current.ime.mode, convStyle), composing: undefined, message: undefined } },
    effect: { kind: 'none' },
  }
}

function imeKey(state: AppState<any>, key: string): { state: AppState<any>; effect: Effect } {
  const current = state.current
  if (current.mode !== 'edit' || current.ime.mode !== 'kana') return { state, effect: { kind: 'none' } }

  const result = reduceImeKey(current.ime, key)
  if (result.action === 'discard') return discardEdit(state)
  if (result.commit !== undefined) return commitImeText(state, result.commit, result.ime, result.lookup, result.learn, result.lookupImmediate)

  return {
    state: { ...state, current: { ...current, ime: result.ime, composing: imeComposing(result.ime), message: undefined } },
    effect: effects(result.lookup ? { kind: 'imeLookup', text: result.lookup, immediate: result.lookupImmediate } : undefined, learnEffect(result.learn)),
  }
}

function imeCandidates(
  state: AppState<any>,
  ev: Extract<AppEvent, { type: 'imeCandidates' }>,
): { state: AppState<any>; effect: Effect } {
  const current = state.current
  if (current.mode !== 'edit' || current.ime.mode !== 'kana') {
    return { state, effect: { kind: 'none' } }
  }
  const nextIme = applyCandidates(current.ime, ev.text, ev.candidates, ev.error)
  if (nextIme === current.ime) return { state, effect: { kind: 'none' } }
  return {
    state: { ...state, current: { ...current, ime: nextIme, composing: imeComposing(nextIme) } },
    effect: { kind: 'none' },
  }
}

function osImeDetected(state: AppState<any>): { state: AppState<any>; effect: Effect } {
  const current = state.current
  if (current.mode !== 'edit') return { state, effect: { kind: 'none' } }
  return {
    state: {
      ...state,
      current: { ...current, status: 'editing', message: 'Turn OFF the OS IME (直接入力にしてください)' },
    },
    effect: { kind: 'none' },
  }
}

function moveImeSelection(state: AppState<any>, delta: number, opts: { wrap?: boolean } = {}): AppState<any> {
  const current = state.current
  if (current.mode !== 'edit' || current.ime.candidates === null || (current.ime.suggesting && current.ime.convStyle !== 'live')) return state
  return { ...state, current: { ...current, ime: moveImeSelectionState(current.ime, delta, opts) } }
}

function confirmImeCandidate(
  state: AppState<any>,
  selected = state.current.mode === 'edit' ? state.current.ime.selected : 0,
): { state: AppState<any>; effect: Effect } {
  const current = state.current
  if (current.mode !== 'edit' || current.ime.candidates === null || (current.ime.suggesting && current.ime.convStyle !== 'live')) {
    return { state, effect: { kind: 'none' } }
  }
  const result = confirmImeCandidateState(current.ime, selected)
  return commitImeText(state, result.commit, result.ime, result.lookup, result.learn, true)
}

function cancelIme(state: AppState<any>): { state: AppState<any>; effect: Effect } {
  const current = state.current
  if (current.mode !== 'edit') return { state, effect: { kind: 'none' } }
  return {
    state: { ...state, current: { ...current, ime: cancelImeState(current.ime), composing: undefined } },
    effect: { kind: 'none' },
  }
}

function commitImeText(
  state: AppState<any>,
  text: string,
  ime = state.current.mode === 'edit' ? createIme(state.current.ime.mode, state.current.ime.convStyle) : createIme('direct'),
  lookup?: string,
  learn?: ImeLearning,
  lookupImmediate = false,
): { state: AppState<any>; effect: Effect } {
  const current = state.current
  if (current.mode !== 'edit' || text.length === 0) return cancelIme(state)
  // 選択範囲があれば置換して確定(通常のIMEと同じ挙動)
  const head = clamp(current.cursor.offset, 0, current.draft.length)
  const anchor = clamp(current.selAnchor ?? head, 0, current.draft.length)
  const start = Math.min(head, anchor)
  const end = Math.max(head, anchor)
  const draft = `${current.draft.slice(0, start)}${text}${current.draft.slice(end)}`
  const cursor = offsetToCursor(draft, start + text.length)
  const next: EditState = {
    ...current,
    draft,
    cursor,
    selAnchor: undefined,
    dirty: true,
    // 文節確定後に残った読み(confirmImeCandidate の rest)を UI に出し続ける。
    // 通常確定(reading が空)では imeComposing が undefined を返すので従来どおり。
    composing: imeComposing(ime),
    ime,
  }
  return {
    state: { ...state, current: { ...next, scrollLine: computeStickyTop(next) } },
    effect: effects(lookup ? { kind: 'imeLookup', text: lookup, immediate: lookupImmediate } : undefined, learnEffect(learn)),
  }
}

function learnEffect(learn: ImeLearning | undefined): Effect | undefined {
  if (!learn) return undefined
  return { kind: 'imeLearn', reading: learn.reading, candidate: learn.candidate }
}

function effects(...items: Array<Effect | undefined>): Effect {
  const actual = items.filter((item): item is Effect => item !== undefined && item.kind !== 'none')
  if (actual.length === 0) return { kind: 'none' }
  if (actual.length === 1) return actual[0]
  return { kind: 'batch', effects: actual }
}

function requestSave(state: AppState<any>): { state: AppState<any>; effect: Effect } {
  const current = state.current
  if (current.mode !== 'edit' || current.status === 'saving') return { state, effect: { kind: 'none' } }

  const next: EditState = { ...current, status: 'saving', message: 'Saving...' }
  const effect: Effect = current.isNew
    ? { kind: 'createFile', path: current.path, content: current.draft }
    : { kind: 'saveFile', path: current.path, content: current.draft, baseMtime: current.baseMtime }

  return { state: { ...state, current: next }, effect }
}

function saveDone(state: AppState<any>, mtime: number): { state: AppState<any>; effect: Effect } {
  const current = state.current
  if (current.mode !== 'edit') return { state, effect: { kind: 'none' } }

  return {
    state: {
      ...state,
      current: {
        ...current,
        baseMtime: mtime,
        dirty: false,
        status: 'editing',
        message: 'Saved',
        isNew: false,
      },
    },
    effect: { kind: 'none' },
  }
}

function saveFailed(state: AppState<any>, status: 'conflict' | 'error', message: string): { state: AppState<any>; effect: Effect } {
  const current = state.current
  if (current.mode !== 'edit') return { state, effect: { kind: 'none' } }
  return { state: { ...state, current: { ...current, status, message } }, effect: { kind: 'none' } }
}

function discardEdit(state: AppState<any>): { state: AppState<any>; effect: Effect } {
  const current = state.current
  if (current.mode !== 'edit') return { state, effect: { kind: 'none' } }

  if (current.dirty && current.status !== 'confirm-discard') {
    return {
      state: {
        ...state,
        current: {
          ...current,
          status: 'confirm-discard',
          message: 'Unsaved changes. Click/Esc again to discard.',
        },
      },
      effect: { kind: 'none' },
    }
  }

  const previous = state.stack.at(-1)
  if (!previous) return { state: { ...state, current: createRecentList([]), exitRequested: false }, effect: { kind: 'none' } }
  return { state: { current: previous, stack: state.stack.slice(0, -1), exitRequested: false }, effect: { kind: 'none' } }
}

function createEdit(
  path: string,
  baseMtime: number,
  draft: string,
  cursor: EditState['cursor'],
  isNew: boolean,
): EditState {
  return {
    mode: 'edit',
    title: fileName(path) || 'EDIT',
    path,
    baseMtime,
    draft,
    dirty: false,
    cursor,
    status: 'editing',
    scrollLine: null,
    isNew,
    ime: createIme('direct'),
  }
}

function offsetToCursor(draft: string, rawOffset: number): EditState['cursor'] {
  const offset = clamp(rawOffset, 0, draft.length)
  const before = draft.slice(0, offset)
  const lines = before.split('\n')
  return {
    offset,
    line: lines.length,
    col: (lines.at(-1) ?? '').length + 1,
  }
}

function moveCursorByLogicalLine(draft: string, cursor: EditState['cursor'], delta: number): EditState['cursor'] {
  const starts = lineStartOffsets(draft)
  const currentLine = clamp(cursor.line - 1, 0, starts.length - 1)
  const targetLine = clamp(currentLine + delta, 0, starts.length - 1)
  if (targetLine === currentLine) return cursor

  const targetStart = starts[targetLine]
  const targetEnd = logicalLineEnd(draft, targetStart)
  const targetLength = targetEnd - targetStart
  const targetCol = clamp(cursor.col, 1, targetLength + 1)
  return {
    offset: targetStart + targetCol - 1,
    line: targetLine + 1,
    col: targetCol,
  }
}

function lineStartOffsets(text: string): number[] {
  const starts = [0]
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n') starts.push(index + 1)
  }
  return starts
}

function logicalLineEnd(text: string, start: number): number {
  const newline = text.indexOf('\n', start)
  return newline === -1 ? text.length : newline
}

function pushCurrent(state: AppState<any>): AppState<any> {
  return { ...state, stack: [...state.stack, state.current], exitRequested: false }
}

function entryToListItem(entry: VaultEntry): ListItem {
  return {
    label: entry.name,
    kind: entry.type,
    path: entry.path,
  }
}

function fileName(path: string): string {
  const parts = path.split('/').filter(Boolean)
  return parts.at(-1) ?? path
}

function parentPath(path: string): string {
  const parts = path.split('/').filter(Boolean)
  parts.pop()
  return parts.join('/')
}

function isMarkdownPath(path: string): boolean {
  return path.toLowerCase().endsWith('.md')
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.min(max, Math.max(min, value))
}
