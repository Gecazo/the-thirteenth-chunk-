import type { Config } from '../config'
import type { Candidate, PerceptionFrame, ScoreParts } from '../types/decisions'
import { actionKeys, type AgentState } from '../types/state'
import { personalityBias } from './personality'
import { trustFor } from './socialModel'
import { overworld, wantsBed } from './sleep/sleepTrigger'
import { gate } from './policies/safetyGate'
import type { ActionBudget } from './policies/actionBudget'

export function utility(s: AgentState, p: PerceptionFrame, config: Config, budget: ActionBudget): Candidate[] {
  const n = s.needs, e = s.emotions
  const bed = p.beds[0]
  const inReach = bed && Math.max(Math.abs(p.position.x - (bed.x + .5)), Math.abs(p.position.z - (bed.z + .5))) <= 2.5 && Math.abs(p.position.y - bed.y) <= 1.5
  const hungry = p.food < 20 && (n.hungerNeed >= config.HUNGER_TRIGGER || (p.health <= 14 && p.food < 18))
  const readyToRest = wantsBed(s, p, config)
  const following = s.runtime.following
  const autonomyBoost = config.AUTONOMY_ENABLED ? (n.energy >= 25 ? 22 : 10) + Math.max(0, Math.round((n.safety - config.SAFETY_TRIGGER) * .25)) : 0
  return actionKeys.map(action => {
    const parts: ScoreParts = { baseWeight: 0, needPressure: 0, emotionModifier: 0, personalityModifier: personalityBias(action, s), socialModifier: 0, contextBonus: 0, riskPenalty: 0 }
    const reasons: string[] = []
    const require = (condition: unknown, reason: string) => { if (!condition) reasons.push(reason) }
    const blocked = gate(action, s, p, config)
    if (blocked) reasons.push(blocked)
    require(budget.ready(action, p.at), 'action cooling down')
    switch (action) {
      case 'FOLLOW_PLAYER':
        require(following && p.followVisible, 'no visible follow target'); parts.baseWeight = 39; parts.needPressure = n.loneliness * .13
        parts.socialModifier = following ? trustFor(s, following) * 10 : 0; parts.emotionModifier = e.joy * 5
        parts.contextBonus = s.goals.intentions.includes('share_company') ? 4 : 0; parts.riskPenalty = (100 - n.safety) * .11; break
      case 'EAT':
        require(hungry && p.inventory.foodCount > 0, 'not hungry or no approved food'); parts.baseWeight = 47; parts.needPressure = n.hungerNeed * .46; break
      case 'GATHER_BASIC':
        require(p.forageId !== null && p.inventory.foodCount === 0 && p.inventory.occupiedSlots < 36 && n.hungerNeed >= 35, 'no usable nearby dropped food or no need')
        parts.baseWeight = 34; parts.needPressure = n.hungerNeed * .33; parts.riskPenalty = (100 - n.safety) * .3; break
      case 'RETREAT_TO_SAFETY':
        parts.baseWeight = 150; parts.needPressure = 100 - n.safety; parts.emotionModifier = e.fear * 12; break
      case 'SEEK_BED': case 'SLEEP':
        require(readyToRest && bed && (action === 'SLEEP' ? inReach : !inReach), 'no usable bed at the required distance or sleep not due')
        parts.baseWeight = action === 'SLEEP' ? 59 : 54; parts.needPressure = n.sleepDebt * .42
        parts.contextBonus = (s.runtime.sleepRequested ? 50 : 0) + (p.timeOfDay > 20000 ? 8 : 0); parts.riskPenalty = (100 - n.safety) * .3; break
      case 'IDLE_SOCIAL':
        require(p.players.length > 0, 'no nearby players for social idle')
        parts.baseWeight = 2; parts.emotionModifier = e.curiosity * 2; parts.socialModifier = p.players.length ? 2 : 0; break
      case 'AUTONOMOUS':
        require(config.AUTONOMY_ENABLED && overworld(p.dimension) && !following && !s.runtime.sleepRequested,
          'survival mode is disabled, outside the Overworld, or a manual task is pending')
        require(!(readyToRest && bed), 'nightly rest takes priority')
        require(!(hungry && (p.inventory.foodCount || p.forageId !== null)), 'food takes priority')
        parts.baseWeight = 44
        parts.contextBonus = autonomyBoost + (s.goals.userGoal ? 2 : 0) + n.boredom * .2
        parts.riskPenalty = (100 - n.safety) * .20; break
      case 'PAUSE_AND_REFLECT':
        require(config.REFLECTION_ENABLED && !following && (e.fear > .48 || n.energy < 18), 'reflection disabled or no reflection trigger')
        parts.baseWeight = 6; parts.emotionModifier = e.fear * 8; break
      case 'STOP': parts.baseWeight = s.runtime.paused || p.sleeping || p.health <= 0 ? 99 : 0; break
    }
    const score = parts.baseWeight + parts.needPressure + parts.emotionModifier + parts.personalityModifier + parts.socialModifier + parts.contextBonus - parts.riskPenalty
    return { action, score: Math.round(score * 100) / 100, eligible: reasons.length === 0, parts, reasons }
  })
}
