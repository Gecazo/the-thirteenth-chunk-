import { focusText } from '../intentionPlanner'
import type { SleepRecord } from '../../storage/types'

export function morningStatement(sleep: SleepRecord): string {
  const thoughts = sleep.intentions.map(i => focusText[i])
  return `Morning. I thought over yesterday. Today I'll ${thoughts.join(', then ') || 'take a look around'}.`
}
