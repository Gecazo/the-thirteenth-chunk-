import { z } from 'zod'
import { actionKeys, milestones, natural, unit } from './state'

export const eventKinds = ['joined', 'company', 'damage', 'danger', 'ate', 'gathered', 'slept', 'woke', 'died', 'command', 'reflection', 'crafted', 'built', 'milestone'] as const
export type EventKind = typeof eventKinds[number]
export const eventSchema = z.strictObject({
  id: z.uuid(), at: natural, day: natural, kind: z.enum(eventKinds), valence: z.number().min(-1).max(1), intensity: unit,
  tag: z.enum(actionKeys).optional(), area: z.string().max(96).optional(), milestone: z.enum(milestones).optional(),
})
export type MemoryEvent = z.infer<typeof eventSchema>
export const memoryKinds = ['episodic', 'semantic', 'social', 'preference', 'danger'] as const
export const memorySchema = z.strictObject({
  id: z.string().min(1).max(120), at: natural, day: natural, kind: z.enum(memoryKinds),
  summary: z.string().min(1).max(260), topics: z.array(z.string().max(40)).max(10), valence: z.number().min(-1).max(1), salience: unit,
})
export type Memory = z.infer<typeof memorySchema>
