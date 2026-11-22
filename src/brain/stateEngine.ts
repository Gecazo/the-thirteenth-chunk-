import type { Logger } from '../infra/logger'
import type { Clock } from '../infra/clock'
import { clamp, defaultState, projectSchema, stateSchema, type AgentState } from '../types/state'

function bounded(raw: unknown, max: number): unknown {
  return typeof raw === 'number' && Number.isFinite(raw) ? clamp(raw, max) : raw
}
const numeric = { vitals: 20, personality: 1, values: 1, emotions: 1, needs: 100 } as const
export function recoverState(raw: unknown, name: string, now: number, log: Logger): AgentState {
  const seed = defaultState(name, now)
  const parsed = stateSchema.safeParse(raw)
  if (parsed.success) return parsed.data
  if (raw !== undefined) log.warn({ fields: parsed.error.issues.map(i => i.path.join('.')).slice(0, 30) }, 'Recovering persisted state from validated fields')
  if (!raw || typeof raw !== 'object' || !('version' in raw) || raw.version !== 1) return seed
  const data = raw as Record<string, unknown>
  for (const key of Object.keys(numeric) as (keyof typeof numeric)[]) {
    const group = data[key]
    if (!group || typeof group !== 'object') continue
    for (const field of Object.keys(seed[key])) {
      const value = bounded((group as Record<string, unknown>)[field], numeric[key])
      if (typeof value === 'number' && Number.isFinite(value)) (seed[key] as Record<string, number>)[field] = value
    }
  }
  const identity = stateSchema.shape.identity.safeParse(data.identity)
  if (identity.success) seed.identity = identity.data
  const goals = stateSchema.shape.goals.safeParse(data.goals)
  if (goals.success) seed.goals = { ...goals.data, intentions: [...new Set(goals.data.intentions)] }
  const circadian = stateSchema.shape.circadian.safeParse(data.circadian)
  if (circadian.success) seed.circadian = circadian.data
  const project = projectSchema.safeParse(data.project)
  if (project.success) seed.project = project.data
  if (data.runtime && typeof data.runtime === 'object' && 'paused' in data.runtime && typeof data.runtime.paused === 'boolean') seed.runtime.paused = data.runtime.paused
  if (Array.isArray(data.social)) {
    const names = new Set<string>()
    for (const item of data.social.slice(0, 100)) {
      const entry = stateSchema.shape.social.element.safeParse(item && typeof item === 'object' ? { ...item, trust: bounded(item.trust, 1) } : item)
      if (!entry.success || names.has(entry.data.player.toLowerCase())) continue
      names.add(entry.data.player.toLowerCase()); seed.social.push(entry.data)
    }
  }
  return stateSchema.parse(seed)
}

export class StateEngine {
  private state: AgentState
  constructor(raw: unknown, name: string, private readonly clock: Clock, log: Logger) {
    this.state = recoverState(raw, name, clock.now(), log)
    this.resetConnection()
  }
  get(): AgentState { return structuredClone(this.state) }
  prepare(mutate: (draft: AgentState) => void): AgentState {
    const draft = this.get()
    mutate(draft)
    draft.identity = this.state.identity
    draft.version = this.state.version
    draft.runtime.updatedAt = this.clock.now()
    for (const key of Object.keys(numeric) as (keyof typeof numeric)[]) {
      const group = draft[key] as Record<string, number>
      for (const field of Object.keys(group)) group[field] = clamp(group[field] ?? NaN, numeric[key])
    }
    for (const person of draft.social) person.trust = clamp(person.trust)
    return stateSchema.parse(draft)
  }
  install(validated: AgentState): void { this.state = stateSchema.parse({ ...validated, identity: this.state.identity }) }
  update(mutate: (draft: AgentState) => void): void { this.install(this.prepare(mutate)) }
  resetConnection(): void {
    this.update(s => { s.circadian.sleeping = false; s.runtime.following = null; s.runtime.sleepRequested = false; s.runtime.lastAction = 'STOP' })
  }
}
