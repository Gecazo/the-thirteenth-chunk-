import { randomUUID } from 'node:crypto'
import { eventSchema, type MemoryEvent } from '../../types/memory'

export class ShortTermMemory {
  private readonly buffer: (MemoryEvent | undefined)[]
  private cursor = 0
  constructor(private readonly capacity: number, raw: unknown[] = []) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError('STM capacity must be positive')
    this.buffer = new Array<MemoryEvent | undefined>(capacity)
    for (const item of raw.slice(-capacity)) {
      const checked = eventSchema.safeParse(item)
      if (checked.success) this.push(checked.data)
    }
  }
  private push(event: MemoryEvent) { this.buffer[this.cursor] = event; this.cursor = (this.cursor + 1) % this.capacity }
  record(event: Omit<MemoryEvent, 'id'>) { this.push(eventSchema.parse({ ...event, id: randomUUID() })) }
  all(): MemoryEvent[] { return this.buffer.slice(this.cursor).concat(this.buffer.slice(0, this.cursor)).filter((e): e is MemoryEvent => e !== undefined).map(e => ({ ...e })) }
  forDay(day: number): MemoryEvent[] { return this.all().filter(e => e.day === day) }
}
