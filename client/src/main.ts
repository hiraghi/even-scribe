import { OsEventTypeList, waitForEvenAppBridge, type EvenHubEvent } from '@evenrealities/even_hub_sdk'
import {
  clearStoredDraft,
  createInitialState,
  formatScreen,
  initGlasses,
  mountEditor,
  offsetToCursor,
  readStoredDraft,
  reduce,
  type AppEvent,
  type AppState,
  type Effect,
  type GlassesRenderer,
  type EditorHandle,
  type StoredDraft,
} from '@eveng2/g2-core'
import { isLearningDictionary, recordLearning, rerankWithLearning, type LearningDictionary } from '@eveng2/jp-ime'
import { lookupImeCandidates } from './ime-lookup'
import { LocalVault, VaultConflictError } from './local-vault'
import { DEFAULT_NEW_NOTE_DIR, loadLocalSettings, mountLocalSettingsUi, saveLocalSettings, type LocalSettings } from './settings-local'

const INPUT_LOCK_MS = 500
const FOREGROUND_ENTER_EVENT = 4
const IME_LOOKUP_DEBOUNCE_MS = 140
const IME_LEARNING_STORAGE_KEY = 'even-scribe.ime-learning'

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) throw new Error('#app not found')
const appRoot: HTMLDivElement = app

const storage = new LocalVault()
let renderer: GlassesRenderer | null = null
let state: AppState = createInitialState()
let inputLockUntil = 0
let cleanedUp = false
let unsubscribe: (() => void) | null = null
let editor: EditorHandle | null = null
let editorPath: string | null = null
let imeLookupTimer: number | null = null
let pendingImeLookupText: string | null = null
let settings: LocalSettings = loadLocalSettings()

const bridge = await waitForEvenAppBridge()
mountShell()
void navigator.storage?.persist?.()

renderer = await initGlasses(bridge)
inputLockUntil = Date.now() + INPUT_LOCK_MS
await startApp()

unsubscribe = bridge.onEvenHubEvent(event => {
  if (isExitEvent(event)) {
    cleanup()
    return
  }

  if (isForegroundEnterEvent(event)) {
    void handleForegroundEnter()
    return
  }

  const appEvent = toAppEvent(event)
  if (appEvent) void dispatch(appEvent)
})

window.addEventListener('keydown', event => {
  if (event.isComposing || event.keyCode === 229) return
  const textTarget = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement
  if (
    !textTarget &&
    ((state.current.mode === 'confirm-save' && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) ||
      (state.current.mode !== 'edit' && (event.key === 'ArrowUp' || event.key === 'ArrowDown')))
  ) {
    event.preventDefault()
    void dispatch({ type: event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? 'scrollUp' : 'scrollDown' })
    return
  }

  if (!textTarget && event.key === 'Enter' && state.current.mode !== 'edit') {
    event.preventDefault()
    void dispatch({ type: 'click' })
    return
  }

  if (!textTarget && event.key === 'Escape') {
    event.preventDefault()
    void dispatch({ type: state.current.mode === 'edit' ? 'discardEdit' : 'doubleClick' })
    return
  }

  if (!textTarget && (event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'n') {
    if (state.current.mode === 'list') {
      event.preventDefault()
      startNameInput('new-folder')
    }
    return
  }

  if (!textTarget && event.key === 'F2' && state.current.mode === 'list') {
    const selected = state.current.items[state.current.selectedIndex]
    if (selected?.kind === 'dir' || selected?.kind === 'file') {
      event.preventDefault()
      startNameInput('rename', selected)
    }
    return
  }

  if (!textTarget && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') {
    if (state.current.mode === 'list') {
      event.preventDefault()
      startNameInput('new-file')
    }
  }
})
window.addEventListener('beforeunload', cleanup)

async function startApp(): Promise<void> {
  await renderText('Loading...')
  try {
    const entries = await storage.recent(10)
    await applyLoaded({ type: 'loadedRecent', entries })
    showDraftRecovery(readStoredDraft())
  } catch (error) {
    await renderText(`!err: ${messageFromUnknown(error)}`)
  }
}

async function dispatch(ev: AppEvent): Promise<void> {
  if (Date.now() < inputLockUntil) return
  await dispatchImmediate(ev)
}

async function dispatchImmediate(ev: AppEvent): Promise<void> {
  const discardingConfirmedEdit = state.current.mode === 'confirm-save' && state.current.selected === 1 && ev.type === 'click'
  const next = reduce(state, ev)
  state = next.state
  state = applySavedConvStyle(state)
  if (discardingConfirmedEdit) clearStoredDraft()
  syncCompanionUi()
  await renderState()
  await handleEffect(next.effect)
}

async function applyLoaded(ev: Extract<AppEvent, { type: 'loadedRecent' | 'loadedTree' | 'loadedFile' }>): Promise<void> {
  const next = reduce(state, ev)
  state = next.state
  state = applySavedConvStyle(state)
  syncCompanionUi()
  await renderState()
}

function applySavedConvStyle(currentState: AppState): AppState {
  if (currentState.current.mode !== 'edit' && currentState.current.mode !== 'name-input') return currentState
  return reduce(currentState, { type: 'imeSetConvStyle', convStyle: settings.convStyle }).state
}

async function handleEffect(effect: Effect): Promise<void> {
  if (effect.kind === 'none') return
  if (effect.kind === 'batch') {
    for (const item of effect.effects) await handleEffect(item)
    return
  }
  if (effect.kind === 'exit') {
    await bridge.shutDownPageContainer(1)
    return
  }

  if (effect.kind === 'saveFile' || effect.kind === 'createFile') {
    try {
      const result =
        effect.kind === 'saveFile'
          ? await storage.saveFile(effect.path, effect.content, effect.baseMtime)
          : await storage.createFile(effect.path, effect.content)
      clearStoredDraft()
      await dispatchImmediate({ type: 'saveDone', mtime: result.mtime })
    } catch (error) {
      const conflict = error instanceof VaultConflictError
      await dispatchImmediate({
        type: 'saveFailed',
        status: conflict ? 'conflict' : 'error',
        message: conflict ? 'Local copy changed. Reload before retry.' : messageFromUnknown(error),
      })
    }
    return
  }

  if (effect.kind === 'createNote' || effect.kind === 'createFolder' || effect.kind === 'rename') {
    try {
      if (effect.kind === 'createNote') await storage.createFile(effect.path, '')
      else if (effect.kind === 'createFolder') await storage.createFolder(effect.path)
      else await storage.rename(effect.oldPath, effect.newPath, effect.isDir)
      if (state.current.mode === 'list' && state.current.kind === 'tree') {
        await handleEffect({ kind: 'openTree', path: state.current.path })
      } else {
        await handleEffect({ kind: 'openRecent' })
      }
    } catch (error) {
      await renderText(`!err: ${messageFromUnknown(error)}`)
    }
    return
  }

  if (effect.kind === 'imeLookup') {
    if (effect.immediate) {
      cancelScheduledImeLookup()
      void runImeLookup(effect.text)
    } else {
      scheduleImeLookup(effect.text)
    }
    return
  }

  if (effect.kind === 'imeLearn') {
    writeImeLearning(recordLearning(readImeLearning(), effect.reading, effect.candidate))
    return
  }

  await renderText('Loading...')
  try {
    if (effect.kind === 'openRecent') {
      const entries = await storage.recent(10)
      await applyLoaded({ type: 'loadedRecent', entries })
      return
    }

    if (effect.kind === 'openTree') {
      const tree = await storage.tree(effect.path)
      await applyLoaded({ type: 'loadedTree', path: tree.path, entries: tree.entries })
      return
    }

    if (effect.kind === 'openFile') {
      const file = await storage.file(effect.path)
      await applyLoaded({ type: 'loadedFile', path: file.path, rawContent: file.content, mtime: file.mtime })
    }
  } catch (error) {
    await renderText(`!err: ${messageFromUnknown(error)}`)
  }
}

async function renderState(): Promise<void> {
  const text = formatScreen(state)
  const screen = document.querySelector<HTMLPreElement>('#screen')
  if (screen) screen.textContent = text
  await renderer?.render({ kind: 'text', text })
  if (state.current.mode === 'edit' || state.current.mode === 'name-input') editor?.focus()
}

async function renderText(text: string): Promise<void> {
  const screen = document.querySelector<HTMLPreElement>('#screen')
  if (screen) screen.textContent = text
  await renderer?.render({ kind: 'text', text })
  if (state.current.mode === 'edit' || state.current.mode === 'name-input') editor?.focus()
}

function syncCompanionUi(): void {
  const current = state.current
  if (current.mode === 'edit') {
    if (editor && editorPath === current.path) {
      editor.setStatus(editorStatusText(current.status, current.message, current.ime.lookupFailed))
      editor.setBaseMtime(current.baseMtime)
      editor.setImeMode(current.ime.mode)
      editor.setImeComposingActive(current.ime.reading !== '' || current.ime.pending !== '' || current.ime.candidates !== null)
      editor.setImeCandidatesVisible(current.ime.candidates !== null)
      editor.setContent(current.draft, current.cursor.offset, current.selAnchor)
      return
    }

    editor?.unmount()
    editorPath = current.path
    editor = mountEditor(
      appRoot,
      {
        path: current.path,
        baseMtime: current.baseMtime,
        content: current.draft,
        cursorOffset: current.cursor.offset,
        status: editorStatusText(current.status, current.message, current.ime.lookupFailed),
      },
      {
        onInput: input => {
          void dispatchImmediate({ type: 'editInput', ...input })
        },
        onSave: () => {
          void dispatchImmediate({ type: 'requestSave' })
        },
        onDiscard: () => {
          void dispatchImmediate({ type: 'discardEdit' })
        },
        onImeToggle: () => {
          void dispatchImmediate({ type: 'imeToggle' })
        },
        onImeSetMode: mode => {
          void dispatchImmediate({ type: 'imeSetMode', mode })
        },
        onImeKey: key => {
          void dispatchImmediate({ type: 'imeKey', key })
        },
        onOsImeComposition: () => {
          void dispatchImmediate({ type: 'osImeDetected' })
        },
      },
    )
    editor.setImeMode(current.ime.mode)
    editor.setImeComposingActive(current.ime.reading !== '' || current.ime.pending !== '' || current.ime.candidates !== null)
    editor.setImeCandidatesVisible(current.ime.candidates !== null)
    return
  }

  if (current.mode === 'name-input') {
    const nameInputKey = `name:${current.kind}`
    if (editor && editorPath === nameInputKey) {
      editor.setStatus(current.label)
      editor.setImeMode(current.ime.mode)
      editor.setImeComposingActive(current.ime.reading !== '' || current.ime.pending !== '' || current.ime.candidates !== null)
      editor.setImeCandidatesVisible(current.ime.candidates !== null)
      editor.setContent(current.buffer, current.cursor.offset, current.selAnchor)
      return
    }

    editor?.unmount()
    editorPath = nameInputKey
    editor = mountEditor(
      appRoot,
      {
        path: current.label,
        baseMtime: 0,
        content: current.buffer,
        cursorOffset: current.cursor.offset,
        selAnchor: current.selAnchor,
        status: current.label,
        singleLine: true,
        persistDraft: false,
        actionLabels: { save: nameInputSubmitLabel(current.kind), discard: 'Cancel' },
      },
      {
        onInput: input => {
          void dispatchImmediate({ type: 'editInput', ...input })
        },
        onSave: () => {
          void dispatchImmediate({ type: 'submitNameInput' })
        },
        onDiscard: () => {
          void dispatchImmediate({ type: 'cancelNameInput' })
        },
        onImeToggle: () => {
          void dispatchImmediate({ type: 'imeToggle' })
        },
        onImeSetMode: mode => {
          void dispatchImmediate({ type: 'imeSetMode', mode })
        },
        onImeKey: key => {
          void dispatchImmediate({ type: 'imeKey', key })
        },
      },
    )
    editor.setImeMode(current.ime.mode)
    editor.setImeComposingActive(current.ime.reading !== '' || current.ime.pending !== '' || current.ime.candidates !== null)
    editor.setImeCandidatesVisible(current.ime.candidates !== null)
    return
  }

  if (current.mode === 'confirm-save') {
    if (editor) {
      editor.unmount()
      editor = null
      editorPath = null
      mountShell()
    }
    mountSaveConfirmation()
    return
  }

  document.querySelector('#save-confirmation')?.remove()
  if (editor) {
    const wasNameInput = editorPath?.startsWith('name:')
    editor.unmount()
    editor = null
    editorPath = null
    mountShell()
    if (!wasNameInput) clearStoredDraft()
  }
}

function mountShell(): void {
  appRoot.innerHTML = ''
  mountLocalSettingsUi(appRoot, settings, next => {
    settings = next
    saveLocalSettings(next)
  })
  const screen = document.createElement('pre')
  screen.id = 'screen'

  appRoot.append(screen)
  showDraftRecovery(readStoredDraft())
}

function showDraftRecovery(draft: StoredDraft | null): void {
  document.querySelector('#draft-recovery')?.remove()
  if (!draft || editor) return

  const screen = document.querySelector<HTMLPreElement>('#screen')
  if (!screen) return

  const row = document.createElement('div')
  row.id = 'draft-recovery'

  const label = document.createElement('span')
  label.textContent = `Unsaved draft: ${draft.path}`

  const restore = document.createElement('button')
  restore.type = 'button'
  restore.textContent = 'Restore'
  restore.addEventListener('click', () => {
    row.remove()
    void dispatchImmediate({
      type: 'restoreDraft',
      path: draft.path,
      baseMtime: draft.baseMtime,
      draft: draft.draft,
      cursor: offsetToCursor(draft.draft, draft.cursorOffset),
      isNew: draft.baseMtime === 0,
    })
  })

  const discard = document.createElement('button')
  discard.type = 'button'
  discard.textContent = 'Discard'
  discard.addEventListener('click', () => {
    clearStoredDraft()
    row.remove()
  })

  row.append(label, restore, discard)
  screen.before(row)
}

type NameInputKind = 'new-file' | 'new-folder' | 'rename'

function startNameInput(kind: NameInputKind, selected?: { label: string; kind: string; path: string }): void {
  if (state.current.mode !== 'list') return
  const directory = state.current.kind === 'tree' ? state.current.path : DEFAULT_NEW_NOTE_DIR
  if (kind === 'rename') {
    if (!selected || (selected.kind !== 'dir' && selected.kind !== 'file')) return
    void dispatchImmediate({
      type: 'startNameInput',
      kind,
      label: 'Rename',
      directory,
      buffer: selected.kind === 'file' ? withoutMarkdownExtension(selected.label) : selected.label,
      targetPath: selected.path,
      isDir: selected.kind === 'dir',
    })
    return
  }
  void dispatchImmediate({
    type: 'startNameInput',
    kind,
    label: kind === 'new-file' ? 'New file name' : 'New folder name',
    directory,
  })
}

function nameInputSubmitLabel(kind: NameInputKind): string {
  if (kind === 'new-file') return 'Create file'
  if (kind === 'new-folder') return 'Create folder'
  return 'Rename'
}

function withoutMarkdownExtension(name: string): string {
  return name.replace(/\.md$/i, '')
}

function mountSaveConfirmation(): void {
  document.querySelector('#save-confirmation')?.remove()
  if (state.current.mode !== 'confirm-save') return

  const panel = document.createElement('div')
  panel.id = 'save-confirmation'
  const label = document.createElement('span')
  label.textContent = 'Save changes?'
  const save = document.createElement('button')
  save.type = 'button'
  save.textContent = 'Save'
  save.autofocus = state.current.selected === 0
  save.addEventListener('click', () => void confirmSaveChoice(0))
  const discard = document.createElement('button')
  discard.type = 'button'
  discard.textContent = 'Discard'
  discard.autofocus = state.current.selected === 1
  discard.addEventListener('click', () => void confirmSaveChoice(1))
  panel.append(label, save, discard)
  const screen = document.querySelector<HTMLPreElement>('#screen')
  screen?.before(panel)
}

async function confirmSaveChoice(selected: 0 | 1): Promise<void> {
  if (state.current.mode !== 'confirm-save') return
  if (state.current.selected !== selected) await dispatchImmediate({ type: 'scrollDown' })
  await dispatchImmediate({ type: 'click' })
}

async function handleForegroundEnter(): Promise<void> {
  if (state.current.mode === 'edit') {
    editor?.focus()
    return
  }

  const draft = readStoredDraft()
  if (!draft) return

  await dispatchImmediate({
    type: 'restoreDraft',
    path: draft.path,
    baseMtime: draft.baseMtime,
    draft: draft.draft,
    cursor: offsetToCursor(draft.draft, draft.cursorOffset),
    isNew: draft.baseMtime === 0,
  })
  editor?.focus()
}

function toAppEvent(event: EvenHubEvent): AppEvent | null {
  const listType = event.listEvent ? event.listEvent.eventType ?? 0 : null
  const listIndex = event.listEvent?.currentSelectItemIndex
  if (listType === OsEventTypeList.CLICK_EVENT) return { type: 'click', index: listIndex }
  if (listType === OsEventTypeList.DOUBLE_CLICK_EVENT) return { type: 'doubleClick' }
  if (typeof listIndex === 'number') return { type: 'listSelect', index: listIndex }

  const sysType = event.sysEvent ? event.sysEvent.eventType ?? 0 : null
  const textType = event.textEvent ? event.textEvent.eventType ?? 0 : null

  if (sysType === OsEventTypeList.DOUBLE_CLICK_EVENT || textType === OsEventTypeList.DOUBLE_CLICK_EVENT) return { type: 'doubleClick' }
  if (sysType === OsEventTypeList.SCROLL_TOP_EVENT || textType === OsEventTypeList.SCROLL_TOP_EVENT) return { type: 'scrollUp' }
  if (sysType === OsEventTypeList.SCROLL_BOTTOM_EVENT || textType === OsEventTypeList.SCROLL_BOTTOM_EVENT) return { type: 'scrollDown' }
  if (sysType === OsEventTypeList.CLICK_EVENT || textType === OsEventTypeList.CLICK_EVENT) return { type: 'click' }

  return null
}

function isExitEvent(event: EvenHubEvent): boolean {
  const sysType = event.sysEvent?.eventType ?? null
  const listType = event.listEvent?.eventType ?? null
  return (
    sysType === OsEventTypeList.SYSTEM_EXIT_EVENT ||
    sysType === OsEventTypeList.ABNORMAL_EXIT_EVENT ||
    listType === OsEventTypeList.SYSTEM_EXIT_EVENT ||
    listType === OsEventTypeList.ABNORMAL_EXIT_EVENT
  )
}

function isForegroundEnterEvent(event: EvenHubEvent): boolean {
  const listType = event.listEvent?.eventType ?? null
  const sysType = event.sysEvent?.eventType ?? null
  const textType = event.textEvent?.eventType ?? null
  return listType === FOREGROUND_ENTER_EVENT || sysType === FOREGROUND_ENTER_EVENT || textType === FOREGROUND_ENTER_EVENT
}

function cleanup(): void {
  if (cleanedUp) return
  cleanedUp = true
  unsubscribe?.()
  editor?.unmount()
  cancelScheduledImeLookup()
}

function scheduleImeLookup(text: string): void {
  pendingImeLookupText = text
  if (imeLookupTimer !== null) window.clearTimeout(imeLookupTimer)
  imeLookupTimer = window.setTimeout(() => {
    imeLookupTimer = null
    const lookupText = pendingImeLookupText
    pendingImeLookupText = null
    if (lookupText) void runImeLookup(lookupText)
  }, IME_LOOKUP_DEBOUNCE_MS)
}

async function runImeLookup(text: string): Promise<void> {
  try {
    const candidates = rerankWithLearning(text, await lookupImeCandidates(text), readImeLearning())
    await dispatchImmediate({ type: 'imeCandidates', text, candidates })
  } catch {
    await dispatchImmediate({ type: 'imeCandidates', text, candidates: [], error: true })
  }
}

function cancelScheduledImeLookup(): void {
  if (imeLookupTimer !== null) {
    window.clearTimeout(imeLookupTimer)
    imeLookupTimer = null
  }
  pendingImeLookupText = null
}

function readImeLearning(): LearningDictionary {
  const raw = window.localStorage.getItem(IME_LEARNING_STORAGE_KEY)
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    return isLearningDictionary(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function writeImeLearning(dict: LearningDictionary): void {
  window.localStorage.setItem(IME_LEARNING_STORAGE_KEY, JSON.stringify(dict))
}

function editorStatusText(status: string, message: string | undefined, imeLookupFailed: boolean): string {
  if (status === 'saving') return 'Saving...'
  if (status === 'conflict') return message ?? 'Local copy changed. Reload before retry.'
  if (status === 'error') return message ?? 'Save failed'
  if (imeLookupFailed) return 'IME candidates unavailable'
  return message ?? 'Editing'
}

function messageFromUnknown(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
