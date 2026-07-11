import { describe, expect, it } from 'vitest'
import { recordLearning, rerankWithLearning, type LearningDictionary } from '../src'

describe('IME learning dictionary', () => {
  it('records confirmed candidates and ignores empty or no-conversion entries', () => {
    const now = Date.UTC(2026, 6, 11)
    const once = recordLearning({}, 'か', '蚊', now)
    const twice = recordLearning(once, 'か', '蚊', now + 1000)

    expect(twice['か']).toEqual([{ reading: 'か', candidate: '蚊', count: 2, lastUsed: now + 1000 }])
    expect(recordLearning(twice, '', '。', now)).toEqual(twice)
    expect(recordLearning(twice, 'か', 'か', now)).toEqual(twice)
  })

  it('reranks API candidates by decayed learning score and inserts learned misses', () => {
    const now = Date.UTC(2026, 6, 11)
    const dict: LearningDictionary = {
      か: [
        { reading: 'か', candidate: '可', count: 1, lastUsed: now },
        { reading: 'か', candidate: '蚊', count: 4, lastUsed: now - 14 * 86_400_000 },
        { reading: 'か', candidate: '香', count: 3, lastUsed: now },
      ],
    }

    expect(rerankWithLearning('か', ['蚊', '可', '課'], dict, now, { insertLimit: 1 })).toEqual(['香', '蚊', '可', '課'])
  })
})
