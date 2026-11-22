import { z } from 'zod'
import { focusText } from '../brain/intentionPlanner'
import { memorySchema } from '../types/memory'
import { focusKeys, milestoneNames, natural, stateSchema } from '../types/state'

const marker = '<!-- soulbot:checkpoint:v1 -->'
const source = z.enum(['deterministic', 'local', 'cloud'])
const sleepRecord = z.strictObject({ day: natural, at: natural, source, events: natural,
  rejections: z.array(z.string()), intentions: z.array(z.enum(focusKeys)).max(3) })
const auditRecord = z.strictObject({ day: natural, at: natural, source, changes: z.record(z.string(), z.strictObject({ before: z.unknown(), after: z.unknown() })) })
export const soulSnapshot = z.strictObject({
  version: z.literal(1), state: z.unknown().refine(v => v !== undefined), events: z.array(z.unknown()),
  memories: z.array(memorySchema).max(2000), sleeps: z.record(z.string().regex(/^(?:0|[1-9]\d*)$/), sleepRecord), audit: z.array(auditRecord).max(2000),
}).refine(s => Object.entries(s.sleeps).every(([key, record]) => key === String(record.day)), { message: 'Sleep record day must match its key' })
export type SoulSnapshot = z.infer<typeof soulSnapshot>

export const emptySoul = (): SoulSnapshot => ({ version: 1, state: null, events: [], memories: [], sleeps: {}, audit: [] })

export function parseSoulDocument(markdown: string): SoulSnapshot {
  const lines = markdown.split(/\r?\n/u)
  const start = lines.indexOf(marker)
  const end = lines.indexOf('```', start + 2)
  if (start === -1 || lines.lastIndexOf(marker) !== start || lines[start + 1] !== '```json' || end === -1) {
    throw new Error('Missing or ambiguous soul.md checkpoint block')
  }
  return soulSnapshot.parse(JSON.parse(lines.slice(start + 2, end).join('\n')))
}

const markdownChars: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '`': '&#96;', '[': '&#91;', ']': '&#93;', '*': '&#42;', '_': '&#95;', '~': '&#126;', '|': '&#124;', '\\': '&#92;' }
const plain = (text: string) => text.replace(/[\p{C}\p{Zl}\p{Zp}]/gu, ' ').replace(/[&<>`\[\]*_~|\\]/gu, c => markdownChars[c] ?? c)
const percent = (value: number) => `${Math.round(value * 100)}%`

export function renderSoulDocument(snapshot: SoulSnapshot): string {
  const lines = ['# SoulBot', '', 'A generated record of a simulated Minecraft companion. This file stores its profile, memories, and sleep history.']
  const state = stateSchema.safeParse(snapshot.state).data
  if (!state) lines.push('', 'The bot will initialize its profile on first startup.')
  else {
    lines.push('', '## Identity', '', `- **Name:** ${plain(state.identity.name)}`, `- **Persona:** ${plain(state.identity.persona)}`,
      `- **Identity ID:** \`${state.identity.id}\``, '', '## Personality and values', '',
      ...[...Object.entries(state.personality), ...Object.entries(state.values)].map(([key, value]) => `- **${key}:** ${percent(value)}`),
      '', '## Current intentions', '', ...state.goals.intentions.map(focus => `- ${focusText[focus]}.`))
    if (state.goals.userGoal) lines.push('', `**Operator note:** ${plain(state.goals.userGoal)}`)
    if (state.project) {
      lines.push('', '## Survival progress', '', ...Object.entries(milestoneNames).map(([key, label]) =>
        `- [${state.project?.milestones?.some(m => m === key) ? 'x' : ' '}] ${label}`))
    }
    if (state.social.length) lines.push('', '## Social memory', '', ...state.social.map(person => `- ${plain(person.player)}: ${percent(person.trust)} simulated trust`))
  }
  lines.push('', '## Recent memories', '', ...(snapshot.memories.length ? snapshot.memories.slice(0, 12).map(m => `- **Day ${m.day} · ${m.kind}:** ${plain(m.summary)}`) : ['No long-term memories yet.']))
  const sleeps = Object.values(snapshot.sleeps).sort((a, b) => b.at - a.at || b.day - a.day)
  lines.push('', '## Recent sleep', '', ...(sleeps.length ? sleeps.slice(0, 8).map(s => `- **Day ${s.day}:** ${s.source} consolidation (${s.events} events); ${s.intentions.map(f => focusText[f]).join(', ')}.`) : ['No nights consolidated yet.']),
    '', '## Saved checkpoint', '', 'The block below is the source of truth. The overview above is regenerated on save.', '', marker,
    '```json', JSON.stringify(snapshot, null, 2), '```', '')
  return lines.join('\n')
}
