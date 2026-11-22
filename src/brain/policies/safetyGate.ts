import type { Action, AgentState } from '../../types/state'
import type { PerceptionFrame } from '../../types/decisions'
import type { Config } from '../../config'
import { recentThreat, safetyLevel } from '../needs'
import { bedHours, overworld } from '../sleep/sleepTrigger'

export function emergency(p: PerceptionFrame, config: Config): boolean {
  return Boolean(p.hazard) || p.breath < 10 || (p.hostiles[0]?.distance ?? Infinity) < 6
    || recentThreat(p.lastDamage, p.at) || safetyLevel(p) < config.SAFETY_TRIGGER
}
export function gate(action: Action, s: AgentState, p: PerceptionFrame, config: Config): string | null {
  if (action === 'STOP') return null
  if (p.health <= 0) return 'not alive'
  if (action === 'RETREAT_TO_SAFETY') return emergency(p, config) ? null : 'no immediate danger'
  if (s.runtime.paused) return 'paused by operator'
  if (emergency(p, config)) return 'emergency preempts routine actions'
  if (p.sleeping) return 'already in bed'
  if ((action === 'SEEK_BED' || action === 'SLEEP') && (!config.ENABLE_SLEEP || !overworld(p.dimension) || !bedHours(p))) return 'bed use disabled or unsafe here'
  return null
}
