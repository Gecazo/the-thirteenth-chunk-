import type { Config } from '../../config'
import type { Advisor } from '../../types/llm'
import { sleepIntegratorPrompt, type SleepFacts } from '../../llm/prompts/sleepIntegratorPrompt'

export function cloudSleepAdvice(provider: Advisor, facts: SleepFacts, config: Config, signal: AbortSignal): Promise<unknown> {
  return provider.propose(sleepIntegratorPrompt(facts, config), signal)
}
