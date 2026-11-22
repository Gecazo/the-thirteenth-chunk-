import type { Candidate, PerceptionFrame } from '../types/decisions'
import type { MemoryEvent } from '../types/memory'
import type { Action, AgentState } from '../types/state'

export interface MonitorThoughts {
  at: number
  chosen: Candidate
  top: Candidate[]
  blocked: Array<{ action: Action; reasons: string[] }>
}

export interface MonitorPatch {
  updatedAt?: number
  status?: 'starting' | 'connected' | 'disconnected' | 'stopped'
  username?: string
  reason?: string
  state?: AgentState
  perception?: PerceptionFrame
  activeAction?: Action | null
  activeJob?: string | null
  thoughts?: MonitorThoughts
  events?: MemoryEvent[]
}

export interface MonitorSink {
  readonly url: string
  setConnectHandler(handler: (() => void) | undefined): void
  setRenderer(fn?: () => string | undefined): void
  update(patch: MonitorPatch): void
  note(level: 'info' | 'warn' | 'error', message: string): void
  close(): Promise<void>
}
