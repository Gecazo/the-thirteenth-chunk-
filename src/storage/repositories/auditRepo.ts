import type { AgentState } from '../../types/state'
import type { AuditRecord, SleepRecord } from '../types'

export function sleepAudit(before: AgentState, after: AgentState, sleep: SleepRecord): AuditRecord {
  const changes: AuditRecord['changes'] = {}
  for (const key of ['personality', 'values', 'social', 'goals', 'circadian', 'needs', 'emotions', 'skills'] as const) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) changes[key] = { before: before[key], after: after[key] }
  }
  if (JSON.stringify(before.journal.notes) !== JSON.stringify(after.journal.notes)) {
    changes.journal = { before: before.journal.notes.map(n => n.id), after: after.journal.notes.map(n => n.id) }
  }
  return { at: sleep.at, day: sleep.day, source: sleep.source, changes }
}
