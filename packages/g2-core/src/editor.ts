import { g2LineEdge, moveOffsetByG2Line, LIST_BODY_ROWS } from './glasses'
import { canStartComposition, isPunctKey, isZenkakuHankakuKey, toImeKey } from '@eveng2/jp-ime'

export interface CursorPosition {
  offset: number
  line: number
  col: number
}

export interface StoredDraft {
  path: string
  baseMtime: number
  draft: string
  cursorOffset: number
  ts: number
}

export interface EditorHandle {
  focus(): void
  setStatus(status: string): void
  setBaseMtime(baseMtime: number): void
  setContent(content: string, cursorOffset: number, selAnchor?: number): void
  setImeMode(mode: 'direct' | 'kana'): void
  setImeComposingActive(active: boolean): void
  setImeCandidatesVisible(visible: boolean): void
  unmount(): void
}

export const DRAFT_STORAGE_KEY = 'obsidian-editor.draft'

export function mountEditor(
  container: HTMLElement,
  initial: {
    path: string
    baseMtime: number
    content: string
    cursorOffset: number
    status?: string
    singleLine?: boolean
    persistDraft?: boolean
    actionLabels?: { save: string; discard: string }
  },
  callbacks: {
    onInput(input: { draft: string; cursor: CursorPosition; composing?: string; selAnchor?: number }): void
    onSave(): void
    onDiscard(): void
    onImeToggle?(): void
    onImeSetMode?(mode: 'direct' | 'kana'): void
    onImeKey?(key: string): void
    onOsImeComposition?(): void
  },
): EditorHandle {
  container.innerHTML = ''

  const root = document.createElement('div')
  root.className = 'editor'

  const toolbar = document.createElement('div')
  toolbar.className = 'editor-toolbar'

  const status = document.createElement('span')
  status.className = 'editor-status'
  status.textContent = initial.status ?? 'Editing'

  const imeModeIndicator = document.createElement('span')
  imeModeIndicator.className = 'editor-ime-mode'
  imeModeIndicator.textContent = 'A'

  const save = document.createElement('button')
  save.type = 'button'
  save.textContent = initial.actionLabels?.save ?? 'Save'
  save.addEventListener('click', callbacks.onSave)

  const discard = document.createElement('button')
  discard.type = 'button'
  discard.textContent = initial.actionLabels?.discard ?? 'Discard'
  discard.addEventListener('click', callbacks.onDiscard)

  const textarea = document.createElement('textarea')
  textarea.value = initial.content
  textarea.spellcheck = false
  textarea.autocapitalize = 'off'
  textarea.autocomplete = 'off'
  textarea.wrap = 'soft'
  if (initial.singleLine) textarea.rows = 1
  textarea.setAttribute('aria-label', `Edit ${initial.path}`)

  toolbar.append(status, imeModeIndicator, save, discard)
  root.append(toolbar, textarea)
  container.append(root)

  const initialOffset = clamp(initial.cursorOffset, 0, textarea.value.length)
  textarea.setSelectionRange(initialOffset, initialOffset)

  let composing: string | undefined
  let draftBaseMtime = initial.baseMtime
  let imeMode: 'direct' | 'kana' = 'direct'
  let imeComposingActive = false
  let lastValue = textarea.value
  let lastOffset = initialOffset
  let lastAnchor = initialOffset
  let lastComposing: string | undefined

  // 選択の可動端(head=カーソル)と固定端(anchor)。selectionDirection でどちらが
  // 動いているかを判定する(shift+← は start 側、shift+→ は end 側が head)。
  const selectionEnds = () => {
    const start = clamp(textarea.selectionStart ?? 0, 0, textarea.value.length)
    const end = clamp(textarea.selectionEnd ?? 0, 0, textarea.value.length)
    const backward = textarea.selectionDirection === 'backward'
    return { head: backward ? start : end, anchor: backward ? end : start }
  }

  const normalizeSingleLine = () => {
    if (!initial.singleLine) return
    const value = textarea.value.replace(/[\r\n]/g, '')
    if (value === textarea.value) return
    const offset = Math.min(textarea.selectionStart ?? value.length, value.length)
    textarea.value = value
    textarea.setSelectionRange(offset, offset)
  }

  const emit = (nextComposing = composing) => {
    normalizeSingleLine()
    const { head: offset, anchor } = selectionEnds()
    if (textarea.value === lastValue && offset === lastOffset && anchor === lastAnchor && nextComposing === lastComposing) return

    lastValue = textarea.value
    lastOffset = offset
    lastAnchor = anchor
    lastComposing = nextComposing
    if (initial.persistDraft !== false) {
      writeStoredDraft({
        path: initial.path,
        baseMtime: draftBaseMtime,
        draft: textarea.value,
        cursorOffset: offset,
        ts: Date.now(),
      })
    }
    callbacks.onInput({
      draft: textarea.value,
      cursor: offsetToCursor(textarea.value, offset),
      composing: nextComposing,
      selAnchor: anchor === offset ? undefined : anchor,
    })
  }

  const emitSelection = () => {
    if (composing !== undefined) return
    emit(undefined)
  }

  textarea.addEventListener('keydown', event => {
    if (event.isComposing || event.keyCode === 229) return
    if (event.key === 'Convert') {
      event.preventDefault()
      callbacks.onImeSetMode?.('kana')
      return
    }
    if (event.key === 'NonConvert') {
      event.preventDefault()
      callbacks.onImeSetMode?.('direct')
      return
    }
    if (isZenkakuHankakuKey(event.key)) {
      event.preventDefault()
      callbacks.onImeToggle?.()
      return
    }
    if (event.ctrlKey && event.key === ' ') {
      event.preventDefault()
      callbacks.onImeToggle?.()
      return
    }
    if (imeMode === 'kana') {
      const imeKey = toImeKey(event)
      if (imeKey && (imeComposingActive || canStartComposition(imeKey) || isPunctKey(imeKey) || imeKey === 'Space' || imeKey.startsWith('Latin:'))) {
        event.preventDefault()
        callbacks.onImeKey?.(imeKey)
        return
      }
    }
    if (initial.singleLine && event.key === 'Enter') {
      event.preventDefault()
      callbacks.onSave()
      return
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      const { head, anchor } = selectionEnds()
      const nextHead = moveOffsetByG2Line(textarea.value, head, event.key === 'ArrowDown' ? 1 : -1)
      if (event.shiftKey && nextHead !== anchor) {
        textarea.setSelectionRange(Math.min(anchor, nextHead), Math.max(anchor, nextHead), nextHead < anchor ? 'backward' : 'forward')
      } else {
        textarea.setSelectionRange(nextHead, nextHead)
      }
      emitSelection()
      return
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      const { head, anchor } = selectionEnds()
      const nextHead = g2LineEdge(textarea.value, head, event.key === 'Home' ? 'home' : 'end')
      if (event.shiftKey && nextHead !== anchor) {
        textarea.setSelectionRange(Math.min(anchor, nextHead), Math.max(anchor, nextHead), nextHead < anchor ? 'backward' : 'forward')
      } else {
        textarea.setSelectionRange(nextHead, nextHead)
      }
      emitSelection()
      return
    }
    // PageUp/PageDown は textarea のネイティブ動作(可視高さ基準)だと G2 の 1 画面
    // (LIST_BODY_ROWS 行)と乖離して飛びすぎる。G2 の表示行単位で 1 画面分だけ送る。
    if (event.key === 'PageUp' || event.key === 'PageDown') {
      event.preventDefault()
      const { head, anchor } = selectionEnds()
      const delta = event.key === 'PageDown' ? LIST_BODY_ROWS : -LIST_BODY_ROWS
      const nextHead = moveOffsetByG2Line(textarea.value, head, delta)
      if (event.shiftKey && nextHead !== anchor) {
        textarea.setSelectionRange(Math.min(anchor, nextHead), Math.max(anchor, nextHead), nextHead < anchor ? 'backward' : 'forward')
      } else {
        textarea.setSelectionRange(nextHead, nextHead)
      }
      emitSelection()
      return
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault()
      callbacks.onSave()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      callbacks.onDiscard()
    }
  })

  textarea.addEventListener('compositionstart', event => {
    composing = event.data
    callbacks.onOsImeComposition?.()
    emit(composing)
  })

  textarea.addEventListener('compositionupdate', event => {
    composing = event.data
    emit(composing)
  })

  textarea.addEventListener('compositionend', () => {
    composing = undefined
    emit(undefined)
  })

  textarea.addEventListener('input', event => {
    const inputEvent = event as InputEvent
    if (inputEvent.inputType === 'insertCompositionText') return
    emit(composing)
  })

  textarea.addEventListener('keyup', emitSelection)
  textarea.addEventListener('click', emitSelection)
  document.addEventListener('selectionchange', emitSelection)

  textarea.focus()
  window.setTimeout(() => textarea.focus(), 0)

  return {
    focus() {
      textarea.focus()
    },
    setStatus(next: string) {
      status.textContent = next
      save.disabled = next === 'Saving...'
    },
    setBaseMtime(next: number) {
      draftBaseMtime = next
    },
    setContent(content: string, cursorOffset: number, selAnchor?: number) {
      const nextContent = initial.singleLine ? content.replace(/[\r\n]/g, '') : content
      const offset = clamp(cursorOffset, 0, nextContent.length)
      if (textarea.value !== nextContent) textarea.value = nextContent
      const anchor = clamp(selAnchor ?? offset, 0, nextContent.length)
      if (anchor === offset) {
        textarea.setSelectionRange(offset, offset)
      } else {
        // state 反映後も選択を collapse させない(shift+← が効かなかった真因)
        textarea.setSelectionRange(Math.min(anchor, offset), Math.max(anchor, offset), offset < anchor ? 'backward' : 'forward')
      }
      lastValue = textarea.value
      lastOffset = offset
      lastAnchor = anchor
    },
    setImeMode(next: 'direct' | 'kana') {
      imeMode = next
      imeModeIndicator.textContent = next === 'kana' ? 'あ' : 'A'
    },
    setImeComposingActive(next: boolean) {
      imeComposingActive = next
    },
    setImeCandidatesVisible(next: boolean) {
      void next
    },
    unmount() {
      document.removeEventListener('selectionchange', emitSelection)
      container.innerHTML = ''
    },
  }
}

export function offsetToCursor(draft: string, rawOffset: number): CursorPosition {
  const offset = clamp(rawOffset, 0, draft.length)
  const before = draft.slice(0, offset)
  const lines = before.split('\n')
  return {
    offset,
    line: lines.length,
    col: (lines.at(-1) ?? '').length + 1,
  }
}

export function readStoredDraft(): StoredDraft | null {
  const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY)
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as Partial<StoredDraft>
    if (typeof parsed.path !== 'string') return null
    if (typeof parsed.baseMtime !== 'number') return null
    if (typeof parsed.draft !== 'string') return null
    if (typeof parsed.cursorOffset !== 'number') return null
    if (typeof parsed.ts !== 'number') return null
    return {
      path: parsed.path,
      baseMtime: parsed.baseMtime,
      draft: parsed.draft,
      cursorOffset: parsed.cursorOffset,
      ts: parsed.ts,
    }
  } catch {
    return null
  }
}

export function writeStoredDraft(draft: StoredDraft): void {
  window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft))
}

export function clearStoredDraft(): void {
  window.localStorage.removeItem(DRAFT_STORAGE_KEY)
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.min(max, Math.max(min, value))
}
