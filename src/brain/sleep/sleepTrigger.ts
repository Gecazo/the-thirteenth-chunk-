import type { Config } from '../../config'
import type { AgentState } from '../../types/state'
import type { PerceptionFrame } from '../../types/decisions'

export const bedHours = (p: Pick<PerceptionFrame, 'timeOfDay' | 'thunder'>) => p.thunder || (p.timeOfDay >= 12541 && p.timeOfDay <= 23458)
export const overworld = (dimension: string) => dimension === 'overworld' || dimension === 'minecraft:overworld'
export function wantsBed(s: AgentState, p: PerceptionFrame, config: Config): boolean {
  const dueByDebt = s.circadian.lastSleepDay !== p.day && s.needs.sleepDebt >= config.SLEEP_TRIGGER
  const dueEveryNight = config.SLEEP_EVERY_NIGHT && s.circadian.lastSleepDay !== p.day
  return config.ENABLE_SLEEP && overworld(p.dimension) && bedHours(p) && !p.sleeping
    && (s.runtime.sleepRequested || dueByDebt || dueEveryNight)
}
