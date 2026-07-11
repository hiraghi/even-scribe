import { GoogleInputToolsProvider } from '@eveng2/jp-ime'

const provider = new GoogleInputToolsProvider(15)

// 同一読みの再lookup(←→の文節伸縮で頻発)をネットワーク往復なしで返す小型LRU。
const CACHE_LIMIT = 100
const cache = new Map<string, string[]>()

export async function lookupImeCandidates(reading: string): Promise<string[]> {
  const hit = cache.get(reading)
  if (hit) {
    cache.delete(reading)
    cache.set(reading, hit)
    return hit
  }
  const candidates = await provider.lookup(reading)
  cache.set(reading, candidates)
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  return candidates
}
