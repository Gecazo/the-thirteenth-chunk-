import type { Config } from '../config'
import type { Decision, PerceptionFrame } from '../types/decisions'
import type { AgentState } from '../types/state'
import { utility } from './utilityScoring'
import type { ActionBudget } from './policies/actionBudget'

export function decide(s: AgentState, p: PerceptionFrame, config: Config, budget: ActionBudget): Decision {
  const candidates = utility(s, p, config, budget).sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.score - a.score)
  const chosen = candidates.find(c => c.eligible) ?? candidates.find(c => c.action === 'STOP')!
  return { chosen, candidates, emergency: chosen.action === 'RETREAT_TO_SAFETY' }
}
