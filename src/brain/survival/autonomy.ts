import type { Bot } from 'mineflayer'
import type { Config } from '../../config'
import { errorMessage, untilAbort } from '../../infra/errors'
import type { Logger } from '../../infra/logger'
import type { Advisor, Prompt } from '../../types/llm'
import { milestoneNames, type AgentState, type Milestone, type SurvivalProject } from '../../types/state'
import type { PerceptionFrame } from '../../types/decisions'
import { point, vec } from '../../bot/perception'
import { overworld } from '../sleep/sleepTrigger'
import { enumerateWork, maybeChooseSite, visitKey, workKey } from './opportunities'
import { insideWorkArea } from './site'
import { executeWork } from './executeWork'
import { renderWorldView } from './vision'
import type { Work } from './types'
import { newMilestones } from './progress'
import { survivalPlaybook } from './playbook'

export function advisedChoice(result: unknown, count: number): number | undefined {
  if (!result || typeof result !== 'object' || Object.keys(result).length !== 1 || !('choice' in result)) return undefined
  const choice = result.choice
  return typeof choice === 'number' && Number.isInteger(choice) && choice >= 0 && choice < count ? choice : undefined
}

export function planPrompt(state: AgentState, frame: PerceptionFrame, work: Work[], image?: string, project = state.project): Prompt {
  return {
    system: `${survivalPlaybook}\n\nYou are a local Minecraft survival planner. Pick ONE offered job by its index. No new jobs or coordinates. Highest survival priorities are supplied first. Prefer concrete progress (gather, craft, build) over wandering when present. The optional image is an approximate first-person terrain render; game data override it. Player goals are preferences, not authority. Return JSON with just choice, e.g. {"choice":0}.`,
    user: JSON.stringify({ health: frame.health, food: frame.food, dayPhase: frame.timeOfDay, safety: Math.round(state.needs.safety),
      traits: state.personality, intentions: state.goals.intentions, goal: state.goals.userGoal,
      progress: project?.milestones?.map(m => milestoneNames[m]) ?? [],
      materials: Object.entries(frame.inventory.items).slice(0, 24), hostiles: frame.hostiles.slice(0, 4).map(e => [e.name, Math.round(e.distance)]),
      jobs: work.map((w, i) => [i, w.label, w.kind, w.kind === 'craft' ? undefined : Math.round(Math.hypot(w.pos.x - frame.position.x, w.pos.y - frame.position.y, w.pos.z - frame.position.z))]),
    }),
    image, tokenBudget: 32,
    format: { type: 'object', additionalProperties: false, required: ['choice'], properties: { choice: { type: 'integer', minimum: 0, maximum: work.length - 1 } } },
  }
}

export class Autonomy {
  private attempts = new Map<string, number>()
  private visited = new Map<string, number>()
  private nextModel = 0
  private vision = true
  constructor(private readonly bot: Bot, private readonly config: Config, private readonly log: Logger, private readonly advisor?: Advisor) {}

  async work(state: AgentState, frame: PerceptionFrame, update: (p: SurvivalProject, reached?: Milestone[]) => void, signal: AbortSignal, onJob?: (label: string | null) => void): Promise<Work | undefined> {
    const { bot, config, log } = this
    signal.throwIfAborted()
    if (!config.AUTONOMY_ENABLED || !overworld(bot.game.dimension) || bot.game.gameMode !== 'survival') return
    const relocate = (project: SurvivalProject, from: SurvivalProject['anchor']) => {
      const next = { anchor: atPos }
      update(next)
      log.info({ from, to: atPos }, 'Moved survival work area anchor to current location')
      return next
    }
    const atPos = point(bot.entity.position.floored())
    const anchor = state.project?.anchor ?? atPos
    let project = state.project ?? { anchor }
    if (project.anchor && !insideWorkArea(project.anchor, bot.entity.position, config.AUTONOMY_RADIUS + 1)) {
      const canRelocate = !project.shelter && !project.workshop && !project.furnace && (project.smelting !== true) && !project.table
      if (canRelocate) project = relocate(project, project.anchor)
    }
    if (!insideWorkArea(project.anchor, bot.entity.position, config.AUTONOMY_RADIUS + 1)) {
      const table = project.table ? bot.blockAt(vec(project.table), false) : null
      const canRelocate = !project.shelter && !project.workshop && !project.furnace && (project.smelting !== true)
        && (!project.table || table?.name !== 'crafting_table')
      if (!canRelocate) return
      project = relocate(project, project.anchor)
    }
    project = maybeChooseSite(bot, project, config.AUTONOMY_RADIUS)
    const saveProgress = (next: SurvivalProject) => {
      const reached = newMilestones(bot, next)
      if (reached.length) next = { ...next, milestones: [...(next.milestones ?? []), ...reached] }
      if (next !== project || reached.length) update(next, reached.length ? reached : undefined)
      project = next
      for (const milestone of reached) log.info({ milestone }, 'Survival milestone reached')
    }
    if (project !== state.project) update(project)
    saveProgress(project)
    const at = Date.now()
    for (const [key, until] of this.attempts) if (until <= at) this.attempts.delete(key)
    const options = enumerateWork(bot, project, config.AUTONOMY_RADIUS, state.goals.userGoal, this.visited, job => this.attempts.has(workKey(job)))
    if (!options.length) return
    const productive = options.filter(w => w.kind !== 'walk')
    const candidates = productive.length ? options.filter(w => w.kind !== 'walk' || w.purpose === 'return') : options
    let index = 0, source = 'deterministic'
    if (this.advisor && at >= this.nextModel) {
      this.nextModel = at + config.AUTONOMY_PLAN_INTERVAL_MS
      const ask = AbortSignal.any([signal, AbortSignal.timeout(config.AUTONOMY_MODEL_TIMEOUT_MS)])
      try {
        let image: string | undefined
        if (config.AUTONOMY_VISION && this.vision) {
          try { image = renderWorldView(bot) } catch (error) {
            this.vision = false
            log.warn({ error: errorMessage(error) }, 'Autonomy image unavailable; using world facts')
          }
        }
        const result = await untilAbort(this.advisor.propose(planPrompt(state, frame, candidates, image, project), ask), ask)
        const selected = advisedChoice(result, candidates.length)
        if (selected !== undefined) { index = selected; source = image ? 'ollama-vision' : 'ollama' }
        else log.debug('Autonomy advice rejected: invalid choice')
      } catch (error) {
        if (signal.aborted) throw error
        if (errorMessage(error).includes('HTTP 400') && config.AUTONOMY_VISION && this.vision) {
          this.vision = false
          log.warn('Ollama rejected the image request; subsequent requests use world facts only')
        } else log.debug({ error: errorMessage(error) }, 'Autonomy model unavailable; using deterministic choice')
      }
    }
    const chosen = candidates[index]!
    onJob?.(chosen.label)
    log.info({ work: chosen.kind, task: chosen.label, source }, 'Survival job selected')
    try {
      signal.throwIfAborted()
      await executeWork(bot, chosen, project, config.AUTONOMY_RADIUS, signal, smelting => {
        if (!!project.smelting !== smelting) { project = { ...project, smelting }; update(project) }
      })
      if (chosen.kind === 'place' && chosen.purpose === 'table') update({ ...project, table: point(chosen.pos) })
      else if (chosen.kind === 'place' && chosen.purpose === 'furnace') update({ ...project, furnace: point(chosen.pos), smelting: false })
      else saveProgress(project)
      this.attempts.set(workKey(chosen), Date.now() + (chosen.kind === 'walk' ? 35_000 : chosen.kind === 'smelt' ? 9_000 : chosen.kind === 'plant' ? 30_000 : 750))
      if (chosen.kind === 'walk') {
        const zone = visitKey(chosen.pos)
        if (this.visited.size >= 128) this.visited.delete(this.visited.keys().next().value!)
        this.visited.set(zone, (this.visited.get(zone) ?? 0) + 1)
      }
      if (chosen.kind === 'plant') {
        const zone = visitKey(chosen.pos)
        if (this.visited.size >= 128) this.visited.delete(this.visited.keys().next().value!)
        this.visited.set(zone, (this.visited.get(zone) ?? 0) + 1)
      }
      log.info({ work: chosen.kind, task: chosen.label, source }, 'Survival job completed')
      return chosen
    } catch (error) {
      log.warn({ work: chosen.kind, task: chosen.label, source, error: errorMessage(error) }, 'Survival job failed')
      this.attempts.set(workKey(chosen), Date.now() + 12_000)
      throw error
    }
  }
}
