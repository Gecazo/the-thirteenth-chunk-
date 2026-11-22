import type { Memory } from '../../types/memory'

export function retrieve(memories: Memory[], query: { topics: string[]; mood: number; now: number; limit: number }): Memory[] {
  const words = new Set(query.topics.map(t => t.toLowerCase()))
  const rank = (m: Memory) => {
    const recency = Math.exp(-Math.max(0, query.now - m.at) / 86_400_000)
    const overlap = m.topics.filter(t => words.has(t.toLowerCase())).length / Math.max(1, words.size)
    const congruence = 1 - Math.abs(m.valence - query.mood) / 2
    return .22 * recency + .4 * m.salience + .28 * Math.min(1, overlap) + .1 * congruence
  }
  return memories.map(m => ({ m, rank: rank(m) })).sort((a, b) => b.rank - a.rank || b.m.at - a.m.at).slice(0, query.limit).map(({ m }) => m)
}
