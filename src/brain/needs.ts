import type { PerceptionFrame } from '../types/decisions'
import { clamp, type AgentState } from '../types/state'

export function recentThreat(damage: PerceptionFrame['lastDamage'], at: number): boolean {
  return Boolean(damage && !damage.environmentalNeed && at - damage.at < 4500)
}

export function safetyLevel(p: PerceptionFrame): number {
  if (p.hazard || p.breath < 10) return 5
  if (recentThreat(p.lastDamage, p.at)) return 12
  const closest = p.hostiles[0]?.distance ?? Infinity
  if (closest < 6) return 5
  if (closest < 10) return 20
  return clamp((closest < 16 ? 65 : 100) - (20 - p.health) * 1.7, 100)
}
export function updateNeeds(s: AgentState, p: PerceptionFrame, seconds: number, producing = false): void {
  const n = s.needs
  n.hungerNeed = (20 - p.food) * 5
  n.safety = safetyLevel(p)
  n.energy = clamp(n.energy + seconds * (p.sleeping ? 6 : -.07), 100)
  n.sleepDebt = clamp(n.sleepDebt + seconds * (p.sleeping ? -8 : .10), 100)
  n.loneliness = clamp(n.loneliness + seconds * (p.players.length ? -.6 : .12), 100)
  // Boredom builds while idle/unproductive and drains while actively doing work.
  n.boredom = clamp(n.boredom + seconds * (p.sleeping || producing ? -3.5 : s.runtime.paused ? 0 : .9), 100)
}
