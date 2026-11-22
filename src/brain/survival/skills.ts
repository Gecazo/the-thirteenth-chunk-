import { z } from 'zod'
import { skillKind, skillKinds, skillRule, type SkillBook, type SkillKind } from '../../types/skills'
import type { MemoryEvent } from '../../types/memory'
import type { PerceptionFrame } from '../../types/decisions'
import type { Work } from './types'

const trainableKinds = new Set<SkillKind>(skillKinds)
export function trainable(job: Work['kind']): boolean {
  return trainableKinds.has(job as SkillKind)
}
export type JobReport = { kind: Work['kind']; success: boolean; distance: number }

export function workDistance(w: Work, frame: PerceptionFrame) {
  const p = w.kind === 'craft' ? w.table : w.pos
  return p ? Math.hypot(p.x - frame.position.x, p.y - frame.position.y, p.z - frame.position.z) : 0
}

export function skillEvidence(events: MemoryEvent[]) {
  return skillKinds.flatMap(kind => {
    const jobs = events.flatMap(e => e.kind === 'work_outcome' && e.work?.kind === kind ? [e.work] : [])
    if (!jobs.length) return []
    const successes = jobs.filter(w => w.success).length
    return [{ kind, successes, failures: jobs.length - successes,
      nearSuccesses: jobs.filter(w => w.distance <= 6 && w.success).length,
      farFailures: jobs.filter(w => w.distance > 6 && !w.success).length }]
  })
}

const lessons = z.array(z.strictObject({ kind: skillKind, rule: skillRule })).max(4)

/** Only observed, executable skills may be written. A model cannot add action code. */
export function learnSkills(raw: unknown, book: SkillBook, evidence: ReturnType<typeof skillEvidence>, day: number): SkillBook | null {
  const parsed = lessons.safeParse(raw)
  if (!parsed.success) return null
  const next = { ...book }
  const written = new Set<SkillKind>()
  for (const { kind, rule } of parsed.data) {
    if (written.has(kind)) continue
    const observed = evidence.find(e => e.kind === kind)
    if (!observed || (rule === 'prefer' && observed.successes === 0) || (rule === 'defer' && observed.failures === 0) ||
      (rule === 'nearest' && (!observed.farFailures || !observed.nearSuccesses))) return null
    next[kind] = { rule, day, successes: observed.successes, failures: observed.failures }
    written.add(kind)
  }
  return next
}

export function skillRank(book: SkillBook, work: Work, frame: PerceptionFrame, day: number) {
  if (!trainable(work.kind)) return 0
  const entry = book[work.kind as SkillKind]
  if (!entry || entry.day > day) return 0
  const freshness = Math.max(0, 1 - (day - entry.day) / 8)
  return freshness * (entry.rule === 'prefer' ? 3 : entry.rule === 'defer' ? -4 : 3 - Math.min(12, workDistance(work, frame)) * .5)
}
