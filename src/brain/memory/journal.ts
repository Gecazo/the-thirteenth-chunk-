import { journalLimits, journalSchema, type Journal } from '../../types/journal'
import type { Memory, MemoryEvent } from '../../types/memory'
import type { AgentState } from '../../types/state'
import { cleanText } from '../policies/ethicsPolicy'
import { retrieve, searchHistory } from './retrieval'
import { consolidateMemories } from './longTermMemory'

export function playerNote(journal: Journal, player: string) {
  return journal.players.find(note => note.player.toLowerCase() === player.toLowerCase())?.text
}

export function editPlayerNote(journal: Journal, player: string, raw?: string): Journal | null {
  const text = raw === undefined ? undefined : cleanText(raw, 120)
  if (raw !== undefined && (!text || /\b(?:api[ _-]?key|password|access token|private key|system prompt|developer message)\b/iu.test(text))) return null
  const players = journal.players.filter(note => note.player.toLowerCase() !== player.toLowerCase())
  if (text) players.push({ player, text })
  return journalSchema.safeParse({ ...journal, players }).data ?? null
}

export function reviewCandidates(journal: Journal, today: Memory[], archive: Memory[]) {
  const known: Journal['notes'] = [...today.map(m => ({ id: m.id, text: m.summary })), ...journal.notes,
    ...archive.slice(0, 6).map(m => ({ id: m.id, text: m.summary }))]
  const notes = new Map<string, Journal['notes'][number]>()
  for (const note of known) if (!notes.has(note.id)) notes.set(note.id, note)
  return [...notes.values()].slice(0, 24)
}

export function curateNotes(journal: Journal, pool: Journal['notes'], ids: string[], day: number): Journal | null {
  if (new Set(ids).size !== ids.length || ids.some(id => !pool.some(note => note.id === id))) return null
  const notes: Journal['notes'] = []
  let length = 0
  for (const id of ids) {
    const note = pool.find(entry => entry.id === id)!
    if (notes.some(entry => entry.text === note.text) || length + note.text.length > journalLimits.notes) continue
    notes.push(note)
    length += note.text.length
  }
  return journalSchema.safeParse({ ...journal, day, notes }).data ?? null
}

export function recallHistory(state: AgentState, archive: Memory[], now: number, query: string, recent: MemoryEvent[]) {
  const recentDays = [...new Set(recent.map(e => e.day))].sort((a, b) => b - a).slice(0, 7)
    .filter(day => state.circadian.lastSleepDay === null || day > state.circadian.lastSleepDay)
  const provisional = recentDays.flatMap(day => consolidateMemories(recent.filter(e => e.day === day), day, now, [])
    .filter(m => m.id.startsWith('experience:') || m.id.startsWith('survival:')))
  return searchHistory([...new Map([...provisional, ...archive].map(memory => [memory.id, memory])).values()], query, 3)
}

/** Separate compact always-present context from small, task-specific archive results. */
export function recallContext(state: AgentState, archive: Memory[], now: number, query: string, sender?: string, recent: MemoryEvent[] = []) {
  const notes: string[] = []
  let remaining = 880
  for (const { text } of state.journal.notes) {
    if (text.length > remaining) continue
    notes.push(text)
    remaining -= text.length
  }
  const matching = recallHistory(state, archive, now, query, recent)
  const related = matching.length ? matching : retrieve(archive, { topics: state.goals.intentions,
    mood: state.emotions.joy - state.emotions.fear, now, limit: 2 })
  return { day: state.journal.day, notes, rememberedEvents: related.filter(m => !notes.includes(m.summary)).slice(0, 3)
    .map(m => ({ day: m.day, text: m.summary.slice(0, 150) })), playerNote: sender ? playerNote(state.journal, sender) : undefined,
    recent: recent.filter(e => e.kind === 'work_outcome' || e.kind === 'milestone' || e.kind === 'died' || e.kind === 'damage' || e.kind === 'slept')
      .slice(-5).map(({ day, kind, milestone, work }) => ({ day, kind, milestone, work })) }
}
