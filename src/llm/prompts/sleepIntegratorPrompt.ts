import { focusKeys, traitKeys, valueKeys, type AgentState, type Focus } from '../../types/state'
import type { Config } from '../../config'
import type { EventKind, MemoryEvent } from '../../types/memory'
import type { Prompt } from '../../types/llm'
import { salience } from '../../brain/memory/salience'

export interface SleepFacts {
  notableEvents: { kind: EventKind; weight: number }[]; total: number; safetyConcerns: boolean; foodConcerns: boolean
  company: boolean; baselineIntentions: Focus[]; traits: AgentState['personality']; values: AgentState['values']; trust: { slot: number; score: number }[]
}
export function sleepFacts(s: AgentState, events: MemoryEvent[], intentions: Focus[], now: number): SleepFacts {
  const has = (...kinds: EventKind[]) => events.some(e => kinds.includes(e.kind))
  return { notableEvents: events.map(e => ({ kind: e.kind, weight: Math.round(salience(e, now) * 100) / 100 })).sort((a, b) => b.weight - a.weight).slice(0, 18),
    total: events.length, safetyConcerns: intentions.includes('stay_safe'), foodConcerns: intentions.includes('eat_well'), company: has('company'),
    baselineIntentions: intentions, traits: s.personality, values: s.values,
    trust: s.social.map((p, slot) => ({ slot, score: Math.round(p.trust * 100) / 100 })).slice(0, 12),
  }
}
export function sleepIntegratorPrompt(facts: SleepFacts, config: Config): Prompt {
  return { system: `Advise on continuity of a simulated Minecraft companion during sleep. Output one JSON object only; optional fields: traitDeltas (${traitKeys.join(', ')}), valueDeltas (${valueKeys.join(', ')}), trustDeltas ([{"slot":0,"delta":0}]), intentions (up to 3 distinct labels), memoryFocus (one label). Labels: ${focusKeys.join(', ')}. Limits: traits ${config.MAX_TRAIT_DRIFT_PER_SLEEP}, values ${config.ALLOW_CORE_VALUE_CHANGE ? config.MAX_VALUE_DELTA_PER_SLEEP : 0} except kindness and prudence always locked, trust ${config.MAX_TRUST_DELTA_PER_SLEEP} for provided slots only. Prefer no changes unless supported. Keep stay_safe first when safetyConcerns is true, and keep eat_well when foodConcerns is true. No commands or free text.`, user: JSON.stringify(facts) }
}
