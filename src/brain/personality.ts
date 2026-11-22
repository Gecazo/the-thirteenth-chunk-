import type { Action, AgentState } from '../types/state'

export function personalityBias(action: Action, s: AgentState): number {
  switch (action) {
    case 'FOLLOW_PLAYER': return s.personality.sociability * 9 + s.values.helpfulness * 2
    case 'GATHER_BASIC': return s.personality.curiosity * 7
    case 'RETREAT_TO_SAFETY': return s.personality.caution * 8 + s.values.prudence * 5
    case 'PAUSE_AND_REFLECT': return s.personality.patience * 8
    case 'IDLE_SOCIAL': return s.personality.sociability * 4 + s.values.kindness * 2
    default: return 0
  }
}
