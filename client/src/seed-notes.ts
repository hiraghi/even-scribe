import type { KeyValueStorage, VaultStorage } from '@eveng2/g2-core'
import manifest from '../app.json'
import manualMarkdown from '../docs/manual.ja.md?raw'
import changelogMarkdown from '../../CHANGELOG.md?raw'

// アプリに最初から入れておく 2 つのノート(使い方 / 変更履歴)。ビルド時に同梱ファイル
// (client/docs/manual.ja.md と リポジトリ直下の CHANGELOG.md)を ?raw で取り込み、
// 起動時に vault へ配置する。「アプリを更新するたびに最新へ上書き」を app.json の
// version をキーにして実現する(同一版では再シードしない)。
const SEED_VERSION_KEY = 'even-scribe.seeded-version'
export const MANUAL_NOTE_PATH = '使い方.md'
export const CHANGELOG_NOTE_PATH = 'CHANGELOG.md'

const SEED_NOTES: ReadonlyArray<{ path: string; content: string }> = [
  { path: MANUAL_NOTE_PATH, content: manualMarkdown },
  { path: CHANGELOG_NOTE_PATH, content: changelogMarkdown },
]

/**
 * 同梱ノート(使い方 / 変更履歴)を vault へ配置する。startApp が recent を読む前に呼ぶこと。
 *
 * - 初回インストール(マーカー無し): 2 ノートを新規作成する。
 * - 更新(app.json の version が変化): 2 ノートを最新の同梱内容で上書きする。ユーザーが
 *   自分で作った他のノートには一切触れない。
 * - 同一 version の再起動: 何もしない(ユーザーがこの 2 ノートを消していても復活させない)。
 *
 * シードは補助的な処理なので、失敗しても起動を止めないよう全体を握りつぶす(ログのみ)。
 */
export async function seedBundledNotes(storage: VaultStorage, persistence: KeyValueStorage): Promise<void> {
  const version = manifest.version
  try {
    const seededVersion = await persistence.get(SEED_VERSION_KEY)
    if (seededVersion === version) return
    for (const note of SEED_NOTES) await upsertNote(storage, note.path, note.content)
    await persistence.set(SEED_VERSION_KEY, version)
  } catch (error) {
    console.warn('Failed to seed bundled notes', error)
  }
}

async function upsertNote(storage: VaultStorage, path: string, content: string): Promise<void> {
  let exists = true
  try {
    await storage.file(path)
  } catch {
    exists = false
  }
  if (exists) await storage.saveFile(path, content)
  else await storage.createFile(path, content)
}
