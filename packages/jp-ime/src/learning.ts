export interface LearningEntry {
  reading: string
  candidate: string
  count: number
  lastUsed: number
}

export type LearningDictionary = Record<string, LearningEntry[]>

export const LEARNING_HALF_LIFE_DAYS = 7
export const LEARNING_INSERT_LIMIT = 5

const DAY_MS = 86_400_000

export function recordLearning(
  dict: LearningDictionary,
  reading: string,
  candidate: string,
  now = Date.now(),
): LearningDictionary {
  if (reading.length === 0 || candidate.length === 0 || candidate === reading) return cloneDictionary(dict)

  const next = cloneDictionary(dict)
  const entries = next[reading] ?? []
  const existing = entries.find(entry => entry.candidate === candidate)
  if (existing) {
    existing.count += 1
    existing.lastUsed = now
  } else {
    entries.push({ reading, candidate, count: 1, lastUsed: now })
  }
  next[reading] = entries
  return next
}

export function rerankWithLearning(
  reading: string,
  candidates: string[],
  dict: LearningDictionary,
  now = Date.now(),
  options: { halfLifeDays?: number; insertLimit?: number } = {},
): string[] {
  const entries = dict[reading] ?? []
  if (entries.length === 0) return [...candidates]

  const halfLifeDays = options.halfLifeDays ?? LEARNING_HALF_LIFE_DAYS
  const insertLimit = options.insertLimit ?? LEARNING_INSERT_LIMIT
  const scored = entries
    .map(entry => ({ entry, score: learningScore(entry, now, halfLifeDays) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || b.entry.lastUsed - a.entry.lastUsed || a.entry.candidate.localeCompare(b.entry.candidate))

  const candidateSet = new Set(candidates)
  const learnedMissing = scored
    .filter(item => !candidateSet.has(item.entry.candidate))
    .slice(0, insertLimit)
    .map(item => item.entry.candidate)

  const scoreByCandidate = new Map(scored.map(item => [item.entry.candidate, item.score]))
  const reranked = candidates
    .map((candidate, index) => ({ candidate, index, score: scoreByCandidate.get(candidate) ?? 0 }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(item => item.candidate)

  return [...learnedMissing, ...reranked.filter(candidate => !learnedMissing.includes(candidate))]
}

export function isLearningDictionary(value: unknown): value is LearningDictionary {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  return Object.values(value).every(entries => Array.isArray(entries) && entries.every(isLearningEntry))
}

function cloneDictionary(dict: LearningDictionary): LearningDictionary {
  return Object.fromEntries(Object.entries(dict).map(([reading, entries]) => [reading, entries.map(entry => ({ ...entry }))]))
}

function learningScore(entry: LearningEntry, now: number, halfLifeDays: number): number {
  const ageDays = Math.max(0, now - entry.lastUsed) / DAY_MS
  return entry.count * 0.5 ** (ageDays / halfLifeDays)
}

function isLearningEntry(value: unknown): value is LearningEntry {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const entry = value as Partial<LearningEntry>
  return (
    typeof entry.reading === 'string' &&
    typeof entry.candidate === 'string' &&
    typeof entry.count === 'number' &&
    Number.isFinite(entry.count) &&
    typeof entry.lastUsed === 'number' &&
    Number.isFinite(entry.lastUsed)
  )
}
