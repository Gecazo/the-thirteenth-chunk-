import type { MemoryEvent } from '../../types/memory'
import { clamp } from '../../types/state'

const novelty = { joined: .18, company: .3, damage: .7, danger: .66, ate: .24, gathered: .28, slept: .45, woke: .32, died: 1, command: .14, reflection: .2, crafted: .38, built: .53, milestone: .85, work_outcome: .34 }
export function salience(event: MemoryEvent, now: number): number {
  const recency = Math.exp(-Math.max(0, now - event.at) / 480_000)
  return clamp(.5 * novelty[event.kind] + .25 * event.intensity + .15 * Math.abs(event.valence) + .1 * recency)
}
