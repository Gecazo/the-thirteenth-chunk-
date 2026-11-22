import { z } from 'zod'
import { focusKeys, traitKeys, valueKeys } from '../types/state'

const signed = z.number().min(-1).max(1)
export const proposalSchema = z.strictObject({
  traitDeltas: z.partialRecord(z.enum(traitKeys), signed).default({}),
  valueDeltas: z.partialRecord(z.enum(valueKeys), signed).default({}),
  trustDeltas: z.array(z.strictObject({ slot: z.number().int().min(0).max(99), delta: signed })).max(12).default([]),
  intentions: z.array(z.enum(focusKeys)).min(1).max(3).optional(),
  memoryFocus: z.enum(focusKeys).optional(),
})
export type Proposal = z.infer<typeof proposalSchema>
export const dialogueSchema = z.strictObject({ reply: z.string().min(1).max(180) })
