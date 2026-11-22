import type { Storage, SleepCommit } from '../types'
import { stateSchema } from '../../types/state'
import { memorySchema } from '../../types/memory'

export class SleepRepo {
  constructor(private readonly storage: Storage) {}
  done(day: number) { return this.storage.slept(day) }
  commit(data: SleepCommit) {
    return this.storage.commitSleep({ ...data, state: stateSchema.parse(data.state), memories: data.memories.map(m => memorySchema.parse(m)) })
  }
}
