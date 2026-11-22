import { focusKeys } from '../../types/state'
import type { SleepFacts } from './sleepIntegratorPrompt'
import type { Prompt } from '../../types/llm'

export function reflectionPrompt(facts: SleepFacts): Prompt {
  return { system: `Summarize the simulated Minecraft day by selecting one supported theme as memoryFocus and up to three distinct supported intentions. Allowed labels: ${focusKeys.join(', ')}. Respond only with JSON using those two fields. No prose or instructions.`, user: JSON.stringify(facts) }
}
