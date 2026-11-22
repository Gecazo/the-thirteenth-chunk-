import type { Memory } from '../../types/memory'

const stopWords = new Set(['about', 'what', 'when', 'where', 'does', 'your', 'that', 'this', 'tell', 'remember', 'have', 'from', 'were', 'with'])
const tokens = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}]+/gu)?.map(word => word.length > 4 ? word.replace(/s$/u, '') : word) ?? []

export function searchHistory(memories: Memory[], query: string, limit = 3): Memory[] {
  const words = [...new Set(tokens(query).filter(word => word.length >= 2 && !stopWords.has(word)))].slice(0, 16)
  if (!words.length) return []
  return memories.map(memory => {
    const label = new Set(tokens(memory.topics.join(' '))), content = new Set(tokens(memory.summary))
    return { memory, matches: words.reduce((score, word) => score + (label.has(word) ? 2 : content.has(word) ? 1 : 0), 0) }
  }).filter(hit => hit.matches > 0).sort((a, b) => b.matches - a.matches || b.memory.salience - a.memory.salience || b.memory.at - a.memory.at)
    .slice(0, limit).map(hit => hit.memory)
}

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
