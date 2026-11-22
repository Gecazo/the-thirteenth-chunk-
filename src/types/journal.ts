import { z } from 'zod'
import { playerName } from '../config'

export const journalLimits = { notes: 2200, players: 1375, noteCount: 12, playerCount: 10 } as const
export const journalSchema = z.strictObject({
  day: z.number().int().nonnegative().nullable(),
  notes: z.array(z.strictObject({ id: z.string().min(1).max(120), text: z.string().min(1).max(260) })).max(journalLimits.noteCount),
  players: z.array(z.strictObject({ player: playerName, text: z.string().min(1).max(120) })).max(journalLimits.playerCount),
}).superRefine((journal, ctx) => {
  for (const key of ['notes', 'players'] as const) {
    if (journal[key].reduce((size, entry) => size + entry.text.length, 0) > journalLimits[key]) {
      ctx.addIssue({ code: 'custom', path: [key], message: 'Memory is over its character budget' })
    }
  }
  if (new Set(journal.notes.map(note => note.id)).size !== journal.notes.length ||
      new Set(journal.players.map(note => note.player.toLowerCase())).size !== journal.players.length) {
    ctx.addIssue({ code: 'custom', message: 'Memory keys must be unique' })
  }
})
export type Journal = z.infer<typeof journalSchema>
export const emptyJournal = (): Journal => ({ day: null, notes: [], players: [] })
