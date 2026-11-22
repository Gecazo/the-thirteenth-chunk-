import type { AgentState } from '../types/state'
import type { Memory, MemoryEvent } from '../types/memory'

export interface SleepRecord {
  day: number; at: number; source: 'deterministic' | 'local' | 'cloud'; events: number
  rejections: string[]; intentions: AgentState['goals']['intentions']
}
export interface AuditRecord { at: number; day: number; source: SleepRecord['source']; changes: Record<string, { before: unknown; after: unknown }> }
export interface Checkpoint { state: AgentState; events: MemoryEvent[] }
export interface SleepCommit extends Checkpoint { sleep: SleepRecord; memories: Memory[]; audit?: AuditRecord }
export interface Storage {
  load(): { state: unknown; events: unknown[] }; memories(): unknown[]; social(): unknown[]; slept(day: number): boolean
  checkpoint(data: Checkpoint): void; commitSleep(data: SleepCommit): boolean; close(): void
}
