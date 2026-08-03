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
  type VaultStorage,
} from '@eveng2/g2-core'
import { isLearningDictionary, recordLearning, rerankWithLearning, type LearningDictionary } from '@eveng2/jp-ime'
import { lookupImeCandidates } from './ime-lookup'
import { LocalVault, VaultConflictError } from './local-vault'
import { MirroredVault } from './mirrored-vault'
import { NativeVault } from './native-vault'
import { createAppPersistence, createNativePersistence } from './persistence'
import { installKeyDebug } from './key-debug'
import { recordImeTiming } from './ime-timing'
import { DEFAULT_NEW_NOTE_DIR, loadLocalSettings, mountLocalSettingsUi, saveLocalSettings, type LocalSettings } from './settings-local'

const INPUT_LOCK_MS = 500
const FOREGROUND_ENTER_EVENT = 4
const IME_LOOKUP_DEBOUNCE_MS = 140
const IME_LEARNING_STORAGE_KEY = 'even-scribe.ime-learning'

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) throw new Error('#app not found')
const appRoot: HTMLDivElement = app

let renderer: GlassesRenderer | null = null
let state: AppState = createInitialState()
let inputLockUntil = 0
let cleanedUp = false
let unsubscribe: (() => void) | null = null
let editor: EditorHandle | null = null
let editorPath: string | null = null
// list 表示中に focus するキー捕捉用の非表示 textarea(S-13/S-14)。モバイル WebView は
// テキスト入力にフォーカスがある時だけ矢印キーを配送するため、非テキストの #file-list ではなく
// これを focus する。
let keySink: HTMLTextAreaElement | null = null
let imeLookupTimer: number | null = null
// S-07: 変換候補の取得中(ネットワーク待ち)だけ true。画面に「変換中…」を出すために使う。
let imeLookupInFlight = false
let pendingImeLookupText: string | null = null
const bridge = await waitForEvenAppBridge()
const nativePersistence = createNativePersistence(bridge)
const persistence = createAppPersistence(bridge)
const storage: VaultStorage = nativePersistence ? new MirroredVault(new LocalVault(), new NativeVault(nativePersistence)) : new LocalVault()
let settings: LocalSettings = await loadLocalSettings(persistence)
const keyDebug = installKeyDebug(() => state.current.mode)
keyDebug.setEnabled(settings.keyDebug || new URLSearchParams(location.search).get('keydebug') === '1')
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
  const textTarget =
    (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) && event.target !== keySink
  // j=↓ / k=↑ (vim 風) をカーソルキーの代替に。Android WebView は非テキスト要素にフォーカスが
  // あると矢印キーをネイティブ(spatial navigation)に奪われページへ配送しない — 実機で確認。英字は
  // 配送されるため、リスト/確認ダイアログの上下移動を j/k でも行えるようにする(矢印も残す)。
  if (
    !textTarget &&
    (((state.current.mode === 'confirm-save' || state.current.mode === 'confirm-delete') && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'j', 'k'].includes(event.key)) ||
      (state.current.mode !== 'edit' && (event.key === 'ArrowUp' || event.key === 'ArrowDown' || event.key === 'j' || event.key === 'k')))
  ) {
    event.preventDefault()
    void dispatch({ type: event.key === 'ArrowUp' || event.key === 'ArrowLeft' || event.key === 'k' ? 'scrollUp' : 'scrollDown' })
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

  if (!textTarget && (event.key === 'Delete' || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd'))) {
    if (state.current.mode === 'list') {
      const selected = state.current.items[state.current.selectedIndex]
      if (selected?.kind === 'dir' || selected?.kind === 'file') {
        event.preventDefault()
        void dispatch({ type: 'requestDelete' })
      }
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
// モバイルは初回タップまで物理キーを配送せず focus も定着しない。以後もタップで
// フォーカスが passive 領域(#screen 等)へ逃げるとキーが来なくなる。タップの度に現在
// モードのキー受け要素へ focus を戻し、キーが window に届く状態を保つ。実操作対象
// (button/入力欄)を叩いた時はブラウザに任せて何もしない。
document.addEventListener('pointerdown', event => {
  const el = event.target instanceof Element ? event.target : null
  if (el?.closest('button, input, textarea, [contenteditable="true"]')) return
  const mode = state.current.mode
  if (mode === 'edit' || mode === 'name-input') editor?.focus()
  else if (mode === 'list') keySink?.focus({ preventScroll: true })
})
window.addEventListener('beforeunload', cleanup)

async function startApp(): Promise<void> {
  await renderText('Loading...')
  try {
    const entries = await storage.recent(10)
    await applyLoaded({ type: 'loadedRecent', entries })
    showDraftRecovery(await readStoredDraft(persistence))
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
  if (discardingConfirmedEdit) await clearStoredDraft(persistence)
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
      await clearStoredDraft(persistence)
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

  if (effect.kind === 'deleteFile') {
    try {
      await storage.deleteFile(effect.path, effect.isDir)
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
      void runImeLookup(effect.text, effect.pendingId)
    } else {
      scheduleImeLookup(effect.text)
    }
    return
  }

  if (effect.kind === 'imeLearn') {
    await writeImeLearning(recordLearning(await readImeLearning(), effect.reading, effect.candidate))
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
  const text = formatScreen(state, undefined, { lookupPending: imeLookupInFlight })
  const screen = document.querySelector<HTMLPreElement>('#screen')
  if (screen) screen.textContent = text
  renderShellList()
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
        draftStorage: persistence,
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

  if (current.mode === 'confirm-delete') {
    if (editor) {
      editor.unmount()
      editor = null
      editorPath = null
      mountShell()
    }
    mountDeleteConfirmation()
    return
  }

  document.querySelector('#save-confirmation')?.remove()
  document.querySelector('#delete-confirmation')?.remove()
  if (editor) {
    const wasNameInput = editorPath?.startsWith('name:')
    editor.unmount()
    editor = null
    editorPath = null
    mountShell()
    if (!wasNameInput) void clearStoredDraft(persistence)
  }
}

function mountShell(): void {
  appRoot.innerHTML = ''
  mountLocalSettingsUi(appRoot, settings, next => {
    settings = next
    keyDebug.setEnabled(next.keyDebug)
    void saveLocalSettings(next, persistence)
  })

  const toolbar = document.createElement('div')
  toolbar.className = 'shell-toolbar'
  const newFileButton = document.createElement('button')
  newFileButton.type = 'button'
  newFileButton.id = 'new-file-button'
  newFileButton.textContent = 'New file'
  // Same entry point as the Ctrl+N keybinding: open the name-input dialog.
  newFileButton.addEventListener('click', () => startNameInput('new-file'))
  toolbar.append(newFileButton)

  const parentButton = document.createElement('button')
  parentButton.type = 'button'
  parentButton.id = 'parent-folder-button'
  parentButton.textContent = '↑ 上へ'
  parentButton.addEventListener('click', () => void dispatchImmediate({ type: 'doubleClick' }))
  toolbar.append(parentButton)

  const screen = document.createElement('pre')
  screen.id = 'screen'

  const fileList = document.createElement('div')
  fileList.id = 'file-list'
  fileList.setAttribute('aria-label', 'Files and folders')
  fileList.tabIndex = -1

  // モバイル WebView は「テキスト入力にフォーカスがある時だけ」矢印キーをページへ配送する
  // (非テキスト要素だと矢印はネイティブに予約され届かない — 実機 ?keydebug で確認)。リスト
  // 表示中はこの非表示 textarea を focus し、矢印を含む物理キーを受ける。inputmode=none で
  // ソフトキーボードは出さず、入力は input で即クリアして溜めない。edit 中は editor が focus。
  const sink = document.createElement('textarea')
  sink.id = 'key-sink'
  sink.tabIndex = -1
  sink.setAttribute('autocomplete', 'off')
  sink.setAttribute('autocapitalize', 'off')
  sink.setAttribute('autocorrect', 'off')
  sink.spellcheck = false
  // 0.6.1(S-13): 0.6.0 は inputmode=none＋1px/opacity:0 の textarea だったが実機で矢印キーが
  // 届かなかった。編集用 textarea(実サイズ・inputmode 既定)は全キーを受ける実績があるため、
  // それに近づける — inputmode=none と極小(1px)をやめ、実サイズのまま opacity:0＋背面(z-index:-1)
  // で不可視化する(画面内なのでスクロールバーも出さない)。物理キーボード接続時はソフトキーボードは
  // 出ない(実機確認済み)。taps は pointer-events:none で下のボタンへ貫通させる。
  sink.style.cssText =
    'position:fixed; left:0; top:0; width:100%; height:2em; opacity:0; z-index:-1; padding:0; border:0; margin:0; resize:none;'
  sink.style.pointerEvents = 'none'
  sink.addEventListener('input', () => {
    sink.value = ''
  })
  keySink = sink

  appRoot.append(toolbar, fileList, screen, sink)
  // 下書き復元プロンプトはアプリ起動時(startApp)だけ出す。編集から一覧へ戻る度には出さない。
}

function renderShellList(): void {
  const fileList = document.querySelector<HTMLDivElement>('#file-list')
  if (!fileList) return
  fileList.replaceChildren()
  const parentButton = document.querySelector<HTMLButtonElement>('#parent-folder-button')
  if (state.current.mode !== 'list') {
    parentButton?.setAttribute('hidden', '')
    return
  }

  const current = state.current
  const canGoToParent = current.kind === 'tree' && (current.path !== '' || state.stack.length > 0)
  parentButton?.toggleAttribute('hidden', !canGoToParent)
  current.items.forEach((item, index) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'file-list-item'
    button.dataset.path = item.path
    button.dataset.kind = item.kind
    button.dataset.index = String(index)
    button.textContent = item.label
    button.setAttribute('aria-current', String(index === current.selectedIndex))
    button.addEventListener('click', () => void openShellListItem(index))
    fileList.append(button)
  })
  // リスト表示中は key-sink(非表示 textarea) を focus し、矢印を含む物理キーを window に届かせる。
  // edit/name-input では上の早期 return で来ないので editor の focus を奪わない。
  if (keySink && document.activeElement !== keySink) keySink.focus({ preventScroll: true })
}

async function openShellListItem(index: number): Promise<void> {
  if (state.current.mode !== 'list') return
  // 選択と open を単一の click(index) で同期 dispatch する。dispatchImmediate は
  // syncCompanionUi(=editor の mount+focus)を最初の await より前に同期実行するので、
  // これで textarea.focus() がタップ gesture 内で走る(モバイルの focus 制約対策)。
  await dispatchImmediate({ type: 'click', index })
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
    void clearStoredDraft(persistence)
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
  document.querySelector('#delete-confirmation')?.remove()
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

function mountDeleteConfirmation(): void {
  document.querySelector('#delete-confirmation')?.remove()
  document.querySelector('#save-confirmation')?.remove()
  if (state.current.mode !== 'confirm-delete') return

  const panel = document.createElement('div')
  panel.id = 'delete-confirmation'
  const label = document.createElement('span')
  label.textContent = `Delete ${state.current.target.label}${state.current.target.isDir ? '/' : ''}?`
  const del = document.createElement('button')
  del.type = 'button'
  del.textContent = 'Delete'
  del.autofocus = state.current.selected === 0
  del.addEventListener('click', () => void confirmDeleteChoice(0))
  const cancel = document.createElement('button')
  cancel.type = 'button'
  cancel.textContent = 'Cancel'
  cancel.autofocus = state.current.selected === 1
  cancel.addEventListener('click', () => void confirmDeleteChoice(1))
  panel.append(label, del, cancel)
  const screen = document.querySelector<HTMLPreElement>('#screen')
  screen?.before(panel)
}

async function confirmDeleteChoice(selected: 0 | 1): Promise<void> {
  if (state.current.mode !== 'confirm-delete') return
  if (state.current.selected !== selected) await dispatchImmediate({ type: 'scrollDown' })
  await dispatchImmediate({ type: 'click' })
}

async function handleForegroundEnter(): Promise<void> {
  if (state.current.mode === 'edit') {
    editor?.focus()
    return
  }

  const draft = await readStoredDraft(persistence)
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

async function runImeLookup(text: string, pendingId?: number): Promise<void> {
  // S-09: 変換候補取得(ネットワーク lookup)の所要時間を毎回記録する。学習の
  // 読み込み/再ランクは含めず、しきい値判断の対象であるネットワーク部分だけ測る。
  const started = performance.now()
  // フォアグラウンド(合成中)の lookup だけフッタに「変換取得中…」を出す(S-07)。
  // 背景の保留変換(S-15, pendingId 有)はマーカー自体が進捗表示なのでフッタは出さない。
  const foreground = pendingId === undefined
  if (foreground) {
    imeLookupInFlight = true
    await renderState()
  }
  try {
    const raw = await lookupImeCandidates(text)
    recordImeTiming(text, performance.now() - started, true)
    if (foreground) imeLookupInFlight = false
    const candidates = rerankWithLearning(text, raw, await readImeLearning())
    await dispatchImmediate({ type: 'imeCandidates', text, candidates, pendingId })
  } catch {
    recordImeTiming(text, performance.now() - started, false)
    if (foreground) imeLookupInFlight = false
    await dispatchImmediate({ type: 'imeCandidates', text, candidates: [], error: true, pendingId })
  }
}

function cancelScheduledImeLookup(): void {
  if (imeLookupTimer !== null) {
    window.clearTimeout(imeLookupTimer)
    imeLookupTimer = null
  }
  pendingImeLookupText = null
}

async function readImeLearning(): Promise<LearningDictionary> {
  const raw = await persistence.get(IME_LEARNING_STORAGE_KEY)
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    return isLearningDictionary(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

async function writeImeLearning(dict: LearningDictionary): Promise<void> {
  await persistence.set(IME_LEARNING_STORAGE_KEY, JSON.stringify(dict))
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
