import { memorySchema } from '../../types/memory'
import type { Storage } from '../types'

export class MemoryRepo {
  constructor(private readonly storage: Storage) {}
  list() { return this.storage.memories().flatMap(v => { const m = memorySchema.safeParse(v); return m.success ? [m.data] : [] }) }
}
