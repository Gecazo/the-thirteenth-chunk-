import pino from 'pino'
import type { PerceptionFrame } from '../types/decisions'

export const log = pino({ level: 'silent' })
export const clock = { now: () => 100_000 }
export const frame = (patch: Partial<PerceptionFrame> = {}): PerceptionFrame => ({
  at: clock.now(), day: 1, timeOfDay: 6000, dimension: 'overworld', thunder: false, sleeping: false,
  position: { x: 0, y: 64, z: 0 }, health: 20, food: 20, breath: 20, inventory: { occupiedSlots: 0, foodCount: 0, items: {} },
  nearby: [], hostiles: [], players: [], beds: [], hazard: null, lastDamage: null, followVisible: false, forageId: null, ...patch,
})
