import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { playerName } from '../config'

export const traitKeys = ['curiosity', 'sociability', 'caution', 'patience'] as const
export const valueKeys = ['kindness', 'prudence', 'helpfulness'] as const
export const focusKeys = ['stay_safe', 'share_company', 'eat_well', 'find_shelter', 'observe_world', 'rest'] as const
export const actionKeys = ['FOLLOW_PLAYER', 'EAT', 'GATHER_BASIC', 'RETREAT_TO_SAFETY', 'SEEK_BED', 'SLEEP', 'AUTONOMOUS', 'IDLE_SOCIAL', 'PAUSE_AND_REFLECT', 'STOP'] as const
export type Action = typeof actionKeys[number]
export type Focus = typeof focusKeys[number]
export const unit = z.number().min(0).max(1)
export const score = z.number().min(0).max(100)
export const natural = z.number().int().nonnegative()
export const blockPoint = z.strictObject({ x: z.number().int().min(-30_000_000).max(30_000_000), y: z.number().int().min(-2048).max(4096), z: z.number().int().min(-30_000_000).max(30_000_000) })
export const milestones = ['stone_tools', 'home', 'iron_tools', 'workshop'] as const
export type Milestone = typeof milestones[number]
export const milestoneNames: Record<Milestone, string> = { stone_tools: 'Stone tools', home: 'Starter home', iron_tools: 'Iron tools', workshop: 'Workshop' }
export const projectSchema = z.strictObject({
  anchor: blockPoint, table: blockPoint.optional(), shelter: blockPoint.optional(), furnace: blockPoint.optional(), workshop: blockPoint.optional(), smelting: z.boolean().optional(),
  milestones: z.array(z.enum(milestones)).max(milestones.length).refine(v => new Set(v).size === v.length).optional(),
})
export type SurvivalProject = z.infer<typeof projectSchema>

export const stateSchema = z.strictObject({
  version: z.literal(1),
  identity: z.strictObject({ id: z.uuid(), name: playerName, createdAt: natural, persona: z.literal('A careful, curious Minecraft companion') }),
  vitals: z.strictObject({ health: z.number().min(0).max(20), food: z.number().min(0).max(20) }),
  personality: z.strictObject({ curiosity: unit, sociability: unit, caution: unit, patience: unit }),
  values: z.strictObject({ kindness: unit, prudence: unit, helpfulness: unit }),
  emotions: z.strictObject({ joy: unit, fear: unit, curiosity: unit, calm: unit }),
  needs: z.strictObject({ energy: score, hungerNeed: score, safety: score, loneliness: score, sleepDebt: score, boredom: score }),
  social: z.array(z.strictObject({ player: playerName, trust: unit, lastSeen: natural })).max(100),
  goals: z.strictObject({ userGoal: z.string().max(120).nullable(), intentions: z.array(z.enum(focusKeys)).max(3) }),
  circadian: z.strictObject({ day: natural, timeOfDay: natural.max(23999), sleeping: z.boolean(), lastSleepDay: natural.nullable() }),
  project: projectSchema.optional(),
  runtime: z.strictObject({ paused: z.boolean(), following: playerName.nullable(), sleepRequested: z.boolean(), lastAction: z.enum(actionKeys), updatedAt: natural }),
}).superRefine((state, ctx) => {
  const names = state.social.map(s => s.player.toLowerCase())
  if (new Set(names).size !== names.length || new Set(state.goals.intentions).size !== state.goals.intentions.length) {
    ctx.addIssue({ code: 'custom', message: 'Social players and intentions must be unique' })
  }
  if (state.runtime.paused && (state.runtime.following || state.runtime.sleepRequested)) {
    ctx.addIssue({ code: 'custom', message: 'Paused state may not have pending manual actions' })
  }
})
export type AgentState = z.infer<typeof stateSchema>
export const clamp = (v: number, max = 1): number => Math.min(max, Math.max(0, v))

export function defaultState(name: string, now: number): AgentState {
  return stateSchema.parse({ version: 1,
    identity: { id: randomUUID(), name, createdAt: now, persona: 'A careful, curious Minecraft companion' },
    vitals: { health: 20, food: 20 }, personality: { curiosity: .62, sociability: .56, caution: .68, patience: .58 },
    values: { kindness: .85, prudence: .82, helpfulness: .75 }, emotions: { joy: .4, fear: .08, curiosity: .45, calm: .66 },
    needs: { energy: 85, hungerNeed: 0, safety: 100, loneliness: 20, sleepDebt: 28, boredom: 0 }, social: [],
    goals: { userGoal: null, intentions: ['observe_world'] },
    circadian: { day: 0, timeOfDay: 0, sleeping: false, lastSleepDay: null },
    runtime: { paused: false, following: null, sleepRequested: false, lastAction: 'STOP', updatedAt: now },
  })
}
