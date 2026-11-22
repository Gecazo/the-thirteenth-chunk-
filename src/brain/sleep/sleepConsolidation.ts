import type { Config } from '../../config'
import type { Clock } from '../../infra/clock'
import type { Logger } from '../../infra/logger'
import { untilAbort } from '../../infra/errors'
import type { Providers } from '../../llm/providerRouter'
import { sleepFacts } from '../../llm/prompts/sleepIntegratorPrompt'
import { reflectionPrompt } from '../../llm/prompts/reflectionPrompt'
import type { SleepRecord } from '../../storage/types'
import type { SleepRepo } from '../../storage/repositories/sleepRepo'
import { sleepAudit } from '../../storage/repositories/auditRepo'
import type { ShortTermMemory } from '../memory/shortTermMemory'
import { consolidateMemories } from '../memory/longTermMemory'
import { focusText, planIntentions } from '../intentionPlanner'
import type { StateEngine } from '../stateEngine'
import { cloudSleepAdvice } from './cloudSleepAdvisor'
import { soulGuard } from './soulGuard'
import { proposalSchema } from '../../llm/schemas'
import { learnSkills, skillEvidence } from '../survival/skills'
import { curateNotes, reviewCandidates } from '../memory/journal'
import type { MemoryRepo } from '../../storage/repositories/memoryRepo'

export async function consolidateSleep(ctx: { config: Config; clock: Clock; log: Logger; providers: Providers; repo: SleepRepo; engine: StateEngine; stm: ShortTermMemory; memories?: MemoryRepo },
  day: number, signal: AbortSignal, adviceSignal: AbortSignal = signal): Promise<SleepRecord | null> {
  const { config, clock, log, providers, repo, engine, stm } = ctx
  const before = engine.get()
  if (signal.aborted || !config.ENABLE_SLEEP || !before.circadian.sleeping || repo.done(day)) return null
  const recent = stm.all().filter(e => e.day <= day && e.day >= day - 6 && (before.circadian.lastSleepDay === null || e.day > before.circadian.lastSleepDay))
  const events = before.circadian.lastSleepDay !== null && before.circadian.lastSleepDay >= day ? stm.forDay(day) : recent
  const byDay = new Map<number, typeof events>([[day, []]])
  for (const event of events) {
    const batch = byDay.get(event.day)
    if (batch) batch.push(event)
    else byDay.set(event.day, [event])
  }
  const intentions = planIntentions(before, events)
  function archive(at: number, focus: typeof intentions) {
    return [...byDay.entries()].sort((a, b) => b[0] - a[0])
      .flatMap(([date, batch]) => consolidateMemories(batch, date, at, date === day ? focus : []))
  }
  const evidence = skillEvidence(events)
  const facts = sleepFacts(before, events, intentions, clock.now())
  const queue = reviewCandidates(before.journal, archive(clock.now(), intentions), ctx.memories?.list() ?? [])
  const rejections: string[] = []
  const awakeBudget = AbortSignal.any([signal, adviceSignal, AbortSignal.timeout(12_000)])
  const proposals = await Promise.all((['local', 'cloud'] as const).map(async source => {
    const provider = providers[source]
    if (!provider || (source === 'cloud' && !config.CLOUD_SLEEP_ENABLED) || (source === 'local' && !config.LOCAL_LLM_ENABLED)) return null
    try {
      const request = source === 'cloud' ? cloudSleepAdvice(provider, facts, config, awakeBudget) : provider.propose(reflectionPrompt(facts, evidence, before.skills, queue), awakeBudget)
      return { source, raw: await untilAbort(request, awakeBudget) }
    } catch { return { source, unavailable: true as const } }
  }))
  if (signal.aborted || repo.done(day)) return null
  const current = engine.get()
  const base = engine.prepare(s => {
    s.goals.intentions = intentions; s.circadian.lastSleepDay = day
    s.needs.sleepDebt -= 55; s.needs.energy += 38
  })
  const sameSocial = before.social.length === current.social.length && before.social.every((p, i) => p.player === current.social[i]?.player)
  const local = proposals[0], cloud = proposals[1]
  let after = base, source: SleepRecord['source'] = 'deterministic', memoryFocus: typeof intentions[number] | undefined
  let learned = base.skills
  let journal = base.journal
  if (local) {
    if (local.unavailable) rejections.push('local: unavailable or invalid JSON')
    else {
      const result = soulGuard(local.raw, base, facts, config, sameSocial, 'local')
      if (result.ok) {
        after = result.state; memoryFocus = result.memoryFocus; source = 'local'
        const { lessons, keepNotes } = proposalSchema.parse(local.raw)
        if (lessons?.length) {
          const next = learnSkills(lessons, base.skills, evidence, day)
          if (next) learned = next
          else rejections.push('local: unsupported skill lesson')
        }
        if (keepNotes?.length) {
          const curated = curateNotes(journal, queue, keepNotes, day)
          if (curated) journal = curated
          else rejections.push('local: unsupported journal selection')
        }
      }
      else rejections.push(`local: ${result.reason}`)
    }
  }
  if (cloud) {
    // Cloud failure resets the proposed profile and intentions, not independent local skill lessons.
    const localFocus = memoryFocus
    after = base; memoryFocus = undefined; source = 'deterministic'
    if (cloud.unavailable) rejections.push('cloud: unavailable or invalid JSON')
    else {
      const result = soulGuard(cloud.raw, base, facts, config, sameSocial, 'cloud')
      if (result.ok) { after = result.state; memoryFocus = result.memoryFocus ?? localFocus; source = 'cloud' }
      else rejections.push(`cloud: ${result.reason}`)
    }
  }
  after = { ...after, skills: learned, journal }
  const at = clock.now()
  const memories = [...new Map(archive(at, after.goals.intentions).reverse().map(memory => [memory.id, memory])).values()]
  const episode = memories.find(memory => memory.id === `day:${day}`)
  if (episode && memoryFocus) {
    episode.summary += ` Reflection: ${focusText[memoryFocus]}.`
    episode.topics = [...new Set([memoryFocus, ...episode.topics])].slice(0, 10)
  }
  const sleep: SleepRecord = { day, at, source, events: events.length, rejections, intentions: after.goals.intentions }
  const audit = config.AUDIT_LOG_SLEEP_DIFFS ? sleepAudit(current, after, sleep) : undefined
  if (!repo.commit({ state: after, events: stm.all(), sleep, audit, memories })) return null
  engine.install(after)
  log.info({ sleep, diff: audit?.changes }, 'Sleep consolidation committed')
  return sleep
}
