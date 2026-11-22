import { proposalSchema } from '../../llm/schemas'
import { stateSchema, traitKeys, valueKeys, type AgentState, type Focus } from '../../types/state'
import type { Config } from '../../config'
import type { SleepFacts } from '../../llm/prompts/sleepIntegratorPrompt'
import { exceedsDrift, limitedDelta } from './driftLimiter'

type GuardResult = { ok: true; state: AgentState; memoryFocus?: Focus } | { ok: false; reason: string }
const reject = (reason: string): GuardResult => ({ ok: false, reason })

export function soulGuard(raw: unknown, state: AgentState, facts: SleepFacts, config: Config, sameSocial: boolean, source: 'local' | 'cloud'): GuardResult {
  // Strict enums and numeric keys leave no channel for unsafe directives, arbitrary text, or extra mutations.
  const parsed = proposalSchema.safeParse(raw)
  if (!parsed.success) return reject('invalid schema, range, or unsafe field')
  const p = parsed.data, next = structuredClone(state)
  if (source === 'cloud' && (p.lessons !== undefined || p.keepNotes !== undefined)) return reject('cloud cannot write local skills or journal')
  if (source === 'local' && (Object.keys(p.traitDeltas).length || Object.keys(p.valueDeltas).length || p.trustDeltas.length)) return reject('local summarization cannot change profile')
  for (const key of traitKeys) {
    const delta = p.traitDeltas[key] ?? 0
    if (exceedsDrift(delta, config.MAX_TRAIT_DRIFT_PER_SLEEP)) return reject(`trait drift: ${key}`)
    next.personality[key] = limitedDelta(next.personality[key], delta, config.MAX_TRAIT_DRIFT_PER_SLEEP)
  }
  for (const key of valueKeys) {
    const delta = p.valueDeltas[key] ?? 0
    if (delta !== 0 && (!config.ALLOW_CORE_VALUE_CHANGE || key !== 'helpfulness')) return reject(`locked value: ${key}`)
    if (exceedsDrift(delta, config.MAX_VALUE_DELTA_PER_SLEEP)) return reject(`value drift: ${key}`)
    next.values[key] = limitedDelta(next.values[key], delta, config.MAX_VALUE_DELTA_PER_SLEEP)
  }
  const seen = new Set<number>()
  for (const { slot, delta } of p.trustDeltas) {
    const person = next.social[slot]
    if (!sameSocial || !person || !facts.trust.some(t => t.slot === slot) || seen.has(slot)) return reject('invalid, stale, or repeated social slot')
    if (exceedsDrift(delta, config.MAX_TRUST_DELTA_PER_SLEEP)) return reject('trust drift')
    person.trust = limitedDelta(person.trust, delta, config.MAX_TRUST_DELTA_PER_SLEEP)
    seen.add(slot)
  }
  const supported = (f: Focus) => facts.baselineIntentions.includes(f) || f === 'rest' || f === 'observe_world' || f === 'find_shelter'
  if (p.memoryFocus && !supported(p.memoryFocus)) return reject('memory focus unsupported by observations')
  if (p.intentions) {
    if (new Set(p.intentions).size !== p.intentions.length || p.intentions.some(f => !supported(f))
      || (facts.safetyConcerns && p.intentions[0] !== 'stay_safe') || (facts.foodConcerns && !p.intentions.includes('eat_well'))) return reject('intentions contradict local observations')
    next.goals.intentions = p.intentions
  }
  const validated = stateSchema.safeParse(next)
  return validated.success ? { ok: true, state: validated.data, memoryFocus: p.memoryFocus } : reject('invalid resulting state')
}
