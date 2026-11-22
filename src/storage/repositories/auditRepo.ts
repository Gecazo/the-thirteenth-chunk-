import type { AgentState } from '../../types/state'
import type { AuditRecord, SleepRecord } from '../types'

export function sleepAudit(before: AgentState, after: AgentState, sleep: SleepRecord): AuditRecord {
  const changes: AuditRecord['changes'] = {}
  for (const key of ['personality', 'values', 'social', 'goals', 'circadian', 'needs', 'emotions'] as const) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) changes[key] = { before: before[key], after: after[key] }
  }
  return { at: sleep.at, day: sleep.day, source: sleep.source, changes }
}
