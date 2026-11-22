import { stateSchema, type AgentState } from '../../types/state'
import type { Storage } from '../types'
import type { MemoryEvent } from '../../types/memory'

export class StateRepo {
  constructor(private readonly storage: Storage) {}
  load() { return this.storage.load() }
  save(state: AgentState, events: MemoryEvent[]) { this.storage.checkpoint({ state: stateSchema.parse(state), events }) }
}
