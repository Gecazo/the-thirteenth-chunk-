import { clamp, type AgentState } from '../types/state'
import type { EventKind } from '../types/memory'

const baseline: AgentState['emotions'] = { joy: .4, fear: .08, curiosity: .45, calm: .66 }
const shifts: Partial<Record<EventKind, Partial<AgentState['emotions']>>> = {
  company: { joy: .17, calm: .08 }, damage: { fear: .55, calm: -.42, joy: -.14 },
  danger: { fear: .3, calm: -.16 }, ate: { joy: .15, calm: .14 }, gathered: { curiosity: .1 },
  slept: { calm: .1 }, woke: { joy: .11, calm: .22, fear: -.2 }, died: { fear: .6, joy: -.25 },
}
export function decayEmotions(emotions: AgentState['emotions'], seconds: number): void {
  const retention = Math.exp(-Math.max(0, seconds) / 65)
  for (const k of Object.keys(baseline) as (keyof typeof baseline)[]) emotions[k] = baseline[k] + (emotions[k] - baseline[k]) * retention
}
export function feel(emotions: AgentState['emotions'], event: EventKind, intensity: number): void {
  const change = shifts[event]
  for (const k of Object.keys(baseline) as (keyof typeof baseline)[]) emotions[k] = clamp(emotions[k] + (change?.[k] ?? 0) * intensity)
}
