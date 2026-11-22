import type { AgentState, Focus } from '../types/state'
import type { MemoryEvent } from '../types/memory'

export const focusText: Record<Focus, string> = {
  stay_safe: 'keep to safer routes', share_company: 'spend time with company', eat_well: 'keep some food handy',
  find_shelter: 'stay near a safe bed', observe_world: 'take a look around', rest: 'make time to rest',
}
export function planIntentions(s: AgentState, events: MemoryEvent[]): Focus[] {
  const result: Focus[] = []
  if (s.needs.safety < 65 || events.some(e => ['damage', 'danger', 'died'].includes(e.kind))) result.push('stay_safe')
  if (s.needs.hungerNeed >= 35 || events.some(e => e.kind === 'ate')) result.push('eat_well')
  if (s.needs.loneliness >= 40 || events.some(e => e.kind === 'company')) result.push('share_company')
  if (result.length < 3 && s.values.prudence >= .7) result.push('find_shelter')
  if (result.length < 3) result.push('observe_world')
  return result.slice(0, 3)
}
