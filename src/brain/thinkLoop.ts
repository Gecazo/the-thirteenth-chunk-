import type { Bot } from 'mineflayer'
import type { Config } from '../config'
import type { Logger } from '../infra/logger'
import type { Clock } from '../infra/clock'
import { delay } from '../infra/clock'
import { errorMessage, untilAbort } from '../infra/errors'
import type { Providers } from '../llm/providerRouter'
import { stopBehavior } from '../behaviors/stopBehavior'
import { followPlayer } from '../behaviors/followPlayer'
import { eatIfHungry } from '../behaviors/eatIfHungry'
import { gatherBasic } from '../behaviors/gatherBasic'
import { idleHumanizer } from '../behaviors/idleHumanizer'
import { safetyBehavior } from '../behaviors/safetyBehavior'
import { findBedAndSleep } from '../behaviors/findBedAndSleep'
import { ProgressWatch } from '../behaviors/recoverFromStuck'
import { blockHazard, hostilesNear, playerEntity, Perception } from '../bot/perception'
import type { PerceptionFrame } from '../types/decisions'
import type { Action } from '../types/state'
import type { EventKind } from '../types/memory'
import type { StateEngine } from './stateEngine'
import type { StateRepo } from '../storage/repositories/stateRepo'
import type { SleepRepo } from '../storage/repositories/sleepRepo'
import type { SleepRecord } from '../storage/types'
import type { ShortTermMemory } from './memory/shortTermMemory'
import { ActionBudget } from './policies/actionBudget'
import { decide } from './decisionEngine'
import { shouldInterrupt } from './interruptionPolicy'
import { recentThreat, updateNeeds } from './needs'
import { decayEmotions, feel } from './emotions'
import { observePlayers } from './socialModel'
import { consolidateSleep } from './sleep/sleepConsolidation'
import { morningStatement } from './sleep/morningRoutine'
import { bedHours, overworld } from './sleep/sleepTrigger'
import { Autonomy } from './survival/autonomy'
import { trainable } from './survival/skills'
import type { MonitorSink } from '../monitor/types'
import type { TeamBoard } from './survival/team'
import type { MemoryRepo } from '../storage/repositories/memoryRepo'

export interface BrainContext { config: Config; log: Logger; clock: Clock; rng: () => number; engine: StateEngine; stateRepo: StateRepo; repo: SleepRepo; stm: ShortTermMemory; providers: Providers; monitor?: MonitorSink; team?: TeamBoard; memories?: MemoryRepo }
const moveActions = new Set<Action>(['FOLLOW_PLAYER', 'SEEK_BED', 'GATHER_BASIC', 'RETREAT_TO_SAFETY'])

export class ThinkLoop {
  readonly sensor: Perception
  readonly budget = new ActionBudget()
  private readonly autonomy: Autonomy
  private life = new AbortController()
  private timer?: NodeJS.Timeout
  private fastTimer?: NodeJS.Timeout
  private active?: { action: Action; abort: AbortController; done: Promise<void> }
  private rest?: { advice: AbortController; done: Promise<void>; record?: SleepRecord; woke: boolean; announced: boolean }
  private progress = new ProgressWatch()
  private frame?: PerceptionFrame
  private nextTick = 0
  private lastTick = 0
  private lastDecision?: Action
  private lastTrace = 0
  private lastSave = 0
  private lastCompany = -Infinity
  private lastDamageEvent = -Infinity
  private danger = false
  private fastAlarm = false
  private ready = false
  private lastUsefulWork = -Infinity
  private currentJob?: string
  constructor(private readonly bot: Bot, private readonly ctx: BrainContext) {
    this.sensor = new Perception(bot, ctx.config)
    this.autonomy = new Autonomy(bot, ctx.config, ctx.log, ctx.providers.local, ctx.team, ctx.memories, ctx.stm)
  }
  get signal() { return this.life.signal }
  get perception() { return this.frame }
  get live() { return this.ready }
  get activity() { return this.currentJob }

  private setJob(label?: string) {
    this.currentJob = label
    this.ctx.monitor?.update({ activeJob: label ?? null })
  }

  /** Surface a bot-side chat line (morning notes, replies) on the dashboard. */
  say(text: string) {
    const clean = text.trim().slice(0, 240)
    if (!clean) return
    this.ctx.monitor?.addBotMessage(clean)
  }

  start() {
    if (this.ready || this.life.signal.aborted) return
    this.ready = true
    this.lastTick = this.ctx.clock.now()
    this.lastTrace = this.lastSave = 0
    this.lastDecision = undefined
    this.nextTick = 0
    this.lastUsefulWork = -Infinity
    this.record('joined', .25, .3)
    this.timer = setInterval(() => this.tickSafely(), Math.min(250, this.ctx.config.THINK_INTERVAL_MS))
    this.fastTimer = setInterval(() => this.checkImmediate(), 250)
    this.tickSafely()
  }
  private get time() { return this.ctx.clock.now() }
  private get day() { return Math.max(0, Math.floor(this.bot.time?.day || 0)) }
  private area() {
    const p = this.bot.entity.position
    return `${this.bot.game.dimension}:${Math.floor(p.x / 16)},${Math.floor(p.y / 16)},${Math.floor(p.z / 16)}`.slice(0, 96)
  }
  private record(kind: EventKind, valence: number, intensity: number, tag?: Action, area?: string) {
    this.ctx.stm.record({ at: this.time, day: this.day, kind, valence, intensity, tag, area })
    this.ctx.engine.update(s => feel(s.emotions, kind, intensity))
  }
  damage(source: string) {
    if (!this.ready) return
    const at = this.time
    const recentlyHurt = this.sensor.sampleDamage()
    if (source === 'unknown' && recentlyHurt && !recentlyHurt.environmentalNeed && at - recentlyHurt.at <= 250) source = recentlyHurt.source
    // At zero food, an un-attributed health tick must not indefinitely preempt eating.
    // Actual mobs, drowning, and hazardous blocks are still checked independently.
    const possibleStarvation = source === 'unknown' && this.bot.food === 0
    this.sensor.damage(at, possibleStarvation ? 'possible starvation' : source, possibleStarvation)
    if (at - this.lastDamageEvent >= 1200) {
      this.lastDamageEvent = at
      this.record('damage', -.8, .85, undefined, this.area())
    }
    this.checkImmediate()
  }
  death() {
    if (!this.ready) return
    this.record('died', -1, 1, undefined, this.area())
    this.suspend('death')
  }
  worldChanged() {
    if (!this.ready) return
    try { this.suspend('dimension change or respawn') } catch (error) { this.ctx.log.error({ error: errorMessage(error) }, 'Could not checkpoint dimension change') }
  }
  private suspend(reason: string) {
    this.ready = false
    clearInterval(this.timer); clearInterval(this.fastTimer)
    this.life.abort(new Error(reason))
    this.cancel(reason)
    this.ctx.engine.resetConnection()
    this.save()
  }
  restart() {
    if (this.ready) return
    this.life = new AbortController(); this.sensor.reset(); this.rest = undefined
    this.frame = undefined; this.danger = this.fastAlarm = false
    this.budget.clear(); this.progress.reset()
    this.start()
  }
  async close() {
    if (this.ready) this.suspend('session ended')
    else this.life.abort(new Error('session ended'))
    await Promise.allSettled([this.active?.done, this.rest?.done])
  }
  save() {
    this.ctx.stateRepo.save(this.ctx.engine.get(), this.ctx.stm.all()); this.lastSave = this.time
  }
  private checkImmediate() {
    if (!this.ready || !this.bot.entity || this.bot.health <= 0) return
    try {
      const damage = this.sensor.sampleDamage()
      const alarm = hostilesNear(this.bot, 10).some(e => e.distance < 6) || blockHazard(this.bot) !== null || (this.bot.oxygenLevel ?? 20) < 10
        || recentThreat(damage, this.time)
      if (alarm && !this.fastAlarm) {
        if (this.active && this.active.action !== 'RETREAT_TO_SAFETY') this.cancel('immediate hazard')
        this.rest?.advice.abort(new Error('immediate hazard'))
        this.rethink()
      }
      this.fastAlarm = alarm
    } catch (error) { this.ctx.log.warn({ error: errorMessage(error) }, 'Fast safety check failed') }
  }
  private tickSafely() {
    if (!this.ready || this.time < this.nextTick || !this.bot.entity || !Number.isFinite(this.bot.health) || !Number.isFinite(this.bot.food)) return
    this.nextTick = this.time + this.ctx.config.THINK_INTERVAL_MS
    try { this.tick() } catch (error) {
      this.cancel('planner failure')
      this.ctx.log.error({ error: errorMessage(error) }, 'Think tick failed; movement stopped')
    }
  }
  private tick() {
    const { engine, config, log } = this.ctx
    const p = this.frame = this.sensor.sample(this.time, engine.get())
    if (this.rest) this.announce(this.rest)
    const elapsed = Math.min(10, Math.max(0, (p.at - this.lastTick) / 1000))
    this.lastTick = p.at
    engine.update(s => {
      s.circadian.day = p.day; s.circadian.timeOfDay = p.timeOfDay; s.circadian.sleeping = p.sleeping
      s.vitals = { health: p.health, food: p.food }
      const producing = p.at - this.lastUsefulWork < 12_000
      updateNeeds(s, p, elapsed, producing); decayEmotions(s.emotions, elapsed); observePlayers(s, p.players, p.at)
    })
    if (p.players.some(e => e.distance < 6) && p.at - this.lastCompany >= 45_000) {
      this.lastCompany = p.at; this.record('company', .55, .5)
    }
    const s = engine.get(), decision = decide(s, p, config, this.budget)
    const action = decision.chosen.action
    const team = this.ctx.team
    if (team && this.active?.action !== 'AUTONOMOUS') team.report(s.runtime.paused ? 'Paused' : p.sleeping ? 'Sleeping' : this.currentJob ?? action.replaceAll('_', ' ').toLowerCase())
    const danger = s.needs.safety < 40
    if (danger && !this.danger) this.record('danger', -.65, .65, 'RETREAT_TO_SAFETY', this.area())
    this.danger = danger
    const trace = { action, active: this.active?.action, day: p.day, timeOfDay: p.timeOfDay, health: p.health, food: p.food,
      hostile: p.hostiles[0]?.name, damage: p.lastDamage && p.at - p.lastDamage.at < 4500 ? p.lastDamage.source : undefined, hazard: p.hazard,
      top: decision.candidates.slice(0, 3), blocked: decision.candidates.filter(x => !x.eligible).map(x => ({ action: x.action, reasons: x.reasons })) }
    this.ctx.monitor?.update({
      updatedAt: p.at,
      state: { ...s, journal: { ...s.journal, players: [] } },
      perception: p,
      activeAction: this.active?.action ?? null,
      thoughts: {
        at: p.at,
        chosen: decision.chosen,
        top: decision.candidates.slice(0, 5),
        blocked: decision.candidates.filter(x => !x.eligible).map(x => ({ action: x.action, reasons: x.reasons })),
      },
      events: this.ctx.stm.all().slice(-30),
      team: team && { id: team.id, peers: team.peers() },
    })
    if (action !== this.lastDecision || p.at - this.lastTrace >= 45_000) { log.info(trace, 'Planner decision'); this.lastDecision = action; this.lastTrace = p.at }
    else log.debug(trace, 'Planner tick')
    if (p.at - this.lastSave >= 20_000) this.save()
    if (this.active) {
      if (shouldInterrupt(this.active.action, action)) { this.cancel(`preempted by ${action}`); this.nextTick = 0 }
      else {
        const target = s.runtime.following ? playerEntity(this.bot, s.runtime.following) : undefined
        const shouldMove = moveActions.has(this.active.action) && (this.active.action !== 'FOLLOW_PLAYER' || Boolean(target && target.position.distanceTo(this.bot.entity.position) > 3.6))
        if (this.progress.stuck(this.bot, p.at, shouldMove)) {
          log.warn({ action: this.active.action }, 'Movement stalled; clearing path and backing off')
          this.budget.defer(this.active.action, p.at, 3000); this.cancel('stuck')
        }
      }
      return
    }
    if (action === 'STOP') { stopBehavior(this.bot); return }
    this.run(action, p, s.runtime.following)
  }
  private run(action: Action, p: PerceptionFrame, following: string | null) {
    const abort = new AbortController(), life = this.life.signal
    const { config } = this.ctx
    const timeBudget = config.ACTION_TIMEOUT_MS + (action === 'AUTONOMOUS' ? config.AUTONOMY_MODEL_TIMEOUT_MS : 0)
    const signal = AbortSignal.any([abort.signal, life, AbortSignal.timeout(timeBudget)])
    this.progress.reset()
    this.ctx.engine.update(s => { s.runtime.lastAction = action })
    this.currentJob = undefined
    this.ctx.monitor?.update({ activeAction: action, activeJob: null, jobSource: null })
    const done = this.act(action, p, following, signal).catch(error => {
      if (abort.signal.aborted || life.aborted) return
      if (action === 'FOLLOW_PLAYER' && signal.aborted) return // planned renewal of a dynamic goal
      this.setJob(`Blocked: ${errorMessage(error).slice(0, 100)}`)
      this.budget.defer(action, this.time, action === 'SLEEP' || action === 'SEEK_BED' ? 8000 : 2200)
      this.ctx.log.warn({ action, error: errorMessage(error) }, 'Action did not complete')
    }).finally(() => {
      stopBehavior(this.bot)
      this.active = undefined
      this.ctx.monitor?.update({ activeAction: null })
    })
    this.active = { action, abort, done }
  }
  private async act(action: Action, p: PerceptionFrame, following: string | null, signal: AbortSignal) {
    if (action !== 'RETREAT_TO_SAFETY') await delay(140 + this.ctx.rng() * 380, signal)
    signal.throwIfAborted()
    switch (action) {
      case 'FOLLOW_PLAYER': if (following) await followPlayer(this.bot, following, this.ctx.config.PERCEPTION_RADIUS, signal); break
      case 'EAT':
        if (await eatIfHungry(this.bot, signal)) { this.record('ate', .5, .65, action); this.lastUsefulWork = this.time }
        break
      case 'GATHER_BASIC': if (p.forageId !== null && await gatherBasic(this.bot, p.forageId, signal)) this.record('gathered', .35, .5, action); break
      case 'RETREAT_TO_SAFETY': await safetyBehavior(this.bot, p, signal); break
      case 'SEEK_BED': case 'SLEEP': await findBedAndSleep(this.bot, p.beds, action === 'SEEK_BED', signal); break
      case 'AUTONOMOUS': {
        const work = await this.autonomy.work(this.ctx.engine.get(), p, (project, reached) => {
          this.ctx.engine.update(s => { s.project = project })
          for (const milestone of reached ?? []) this.ctx.stm.record({ at: this.time, day: this.day, kind: 'milestone', valence: .8, intensity: .75, tag: action, milestone })
          this.save()
        }, signal, label => this.setJob(label), outcome => {
          if (!trainable(outcome.kind)) return
          const work = { kind: outcome.kind as 'tree' | 'mine' | 'craft' | 'place' | 'plant' | 'smelt' | 'walk', success: outcome.success, distance: outcome.distance }
          this.ctx.stm.record({ at: this.time, day: p.day, kind: 'work_outcome', valence: outcome.success ? .4 : -.35,
            intensity: .5, tag: action, work })
          if (outcome.success) this.lastUsefulWork = this.time
        }, source => this.ctx.monitor?.update({ jobSource: source }))
        if (!work) { this.budget.defer(action, this.time, 4000); break }
        if (work.kind === 'mine' || work.kind === 'tree') this.record('gathered', .4, .5, action)
        if (work.kind === 'plant') this.record('gathered', .35, .45, action)
        if (work.kind === 'craft') this.record('crafted', .48, .55, action)
        if (work.kind === 'place') this.record('built', .55, .6, action)
        this.setJob(`Finished: ${work.label}`)
        break
      }
      case 'IDLE_SOCIAL': await idleHumanizer(this.bot, this.ctx.rng, signal); break
      case 'PAUSE_AND_REFLECT':
        await delay(350, signal); this.record('reflection', .12, .25, action); this.budget.defer(action, this.time, 120_000); break
    }
  }
  cancel(reason: string) {
    this.active?.abort.abort(new Error(reason))
    if (this.active) { this.setJob(); this.ctx.monitor?.update({ jobSource: null }) }
    if (this.bot.pathfinder && this.bot.entity) stopBehavior(this.bot)
    this.ctx.monitor?.note('info', `Action cancelled: ${reason}`)
  }
  rethink() { this.nextTick = 0 }
  manual(action: 'follow' | 'stop' | 'sleep' | 'goal' | 'play', value?: string) {
    this.ctx.engine.update(s => {
      if (action === 'goal') { s.goals.userGoal = value ?? null; return }
      s.runtime.paused = action === 'stop'; s.runtime.following = action === 'follow' ? value ?? null : null
      s.runtime.sleepRequested = action === 'sleep'; s.runtime.lastAction = 'STOP'
    })
    if (action !== 'goal') this.cancel(`operator ${action}`)
    if (action === 'play') this.budget.defer('AUTONOMOUS', this.time, 0)
    if (action === 'stop' && this.bot.isSleeping) void this.bot.wake().catch(() => {})
    if (action === 'stop') this.rest?.advice.abort(new Error('operator stop'))
    if (action === 'sleep') { this.budget.defer('SLEEP', this.time, 0); this.budget.defer('SEEK_BED', this.time, 0) }
    this.record('command', .1, .2); this.save(); this.rethink()
  }
  slept() {
    if (!this.ready || !this.ctx.config.ENABLE_SLEEP || !overworld(this.bot.game.dimension)) return
    if (this.ctx.engine.get().runtime.paused) { void this.bot.wake().catch(() => {}); return }
    if (this.rest && !this.rest.woke) return
    this.ctx.engine.update(s => { s.circadian.sleeping = true; s.runtime.sleepRequested = false })
    this.record('slept', .35, .5, 'SLEEP')
    const day = this.day, signal = this.life.signal
    this.ctx.log.info({ day }, 'Server confirmed bed sleep')
    const rest: NonNullable<ThinkLoop['rest']> = { advice: new AbortController(), woke: false, announced: false, done: Promise.resolve() }
    this.rest = rest
    rest.done = consolidateSleep(this.ctx, day, signal, rest.advice.signal).then(record => {
      if (!record || signal.aborted) return
      rest.record = record
      this.announce(rest)
    }).catch(error => this.ctx.log.error({ error: errorMessage(error), day }, 'Sleep consolidation failed without applying changes'))
    // A multiplayer server may not advance the night. Stay in bed until wake, dawn or danger.
    void delay(1500, signal).then(async () => {
      while (this.rest === rest && !rest.woke && this.bot.isSleeping) {
        if (!bedHours({ timeOfDay: this.bot.time.timeOfDay, thunder: this.bot.isRaining && this.bot.thunderState > 0 })) {
          await untilAbort(this.bot.wake(), signal); break
        }
        await delay(1500, signal)
      }
    }).catch(() => {})
  }
  woke() {
    if (!this.ready) return
    this.ctx.engine.update(s => { s.circadian.sleeping = false })
    this.record('woke', .4, .5)
    if (this.rest) {
      // Some servers skip the night before Ollama can answer. The bounded review may finish at dawn.
      this.rest.woke = true
      this.announce(this.rest)
    }
    this.rethink()
  }
  private announce(rest: NonNullable<ThinkLoop['rest']>) {
    if (rest.announced || !rest.woke || !rest.record || !this.ready || this.ctx.engine.get().runtime.paused) return
    if (this.bot.isSleeping || this.bot.time.timeOfDay >= 12541) return
    rest.announced = true
    const morning = morningStatement(rest.record)
    this.say(morning)
    this.bot.chat(morning)
  }
}
