import type { Action, Focus } from './state'

export interface Point { x: number; y: number; z: number }
export interface SensedEntity { id: number; name: string; distance: number; position: Point }
export interface PerceptionFrame {
  at: number; day: number; timeOfDay: number; dimension: string; thunder: boolean; sleeping: boolean
  position: Point; health: number; food: number; breath: number
  inventory: { occupiedSlots: number; foodCount: number; items: Record<string, number> }
  nearby: SensedEntity[]; hostiles: SensedEntity[]; players: SensedEntity[]; beds: Point[]
  hazard: string | null; lastDamage: { at: number; source: string; environmentalNeed?: boolean } | null
  followVisible: boolean; forageId: number | null
}
export interface ScoreParts {
  baseWeight: number; needPressure: number; emotionModifier: number; personalityModifier: number
  socialModifier: number; contextBonus: number; riskPenalty: number
}
export interface Candidate { action: Action; eligible: boolean; score: number; parts: ScoreParts; reasons: string[]; focus?: Focus }
export interface Decision { chosen: Candidate; candidates: Candidate[]; emergency: boolean }
