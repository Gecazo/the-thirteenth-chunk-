import { z } from 'zod'

export const skillKinds = ['tree', 'mine', 'craft', 'place', 'plant', 'smelt', 'walk'] as const
export const skillKind = z.enum(skillKinds)
export type SkillKind = z.infer<typeof skillKind>
export const skillRule = z.enum(['prefer', 'nearest', 'defer'])
export const skillBook = z.partialRecord(skillKind, z.strictObject({
  rule: skillRule, day: z.number().int().nonnegative(), successes: z.number().int().min(0).max(2000), failures: z.number().int().min(0).max(2000),
}))
export type SkillBook = z.infer<typeof skillBook>
