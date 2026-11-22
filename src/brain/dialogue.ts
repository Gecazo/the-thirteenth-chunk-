import type { Advisor } from '../types/llm'
import type { AgentState } from '../types/state'
import { cleanText } from './policies/ethicsPolicy'
import { dialoguePrompt } from '../llm/prompts/dialoguePrompt'
import { dialogueSchema } from '../llm/schemas'
import { focusText } from './intentionPlanner'

const consciousness = /\b(?:conscious\w*|sentien\w*|self[ -]?aware\w*|real feelings|truly alive)\b/iu

export async function replyToChat(chat: string, state: AgentState, local: Advisor | undefined, signal: AbortSignal): Promise<string | null> {
  const safe = cleanText(chat, 160)
  if (!safe || signal.aborted) return null
  if (consciousness.test(safe)) return 'I simulate a Minecraft companion. I do not have feelings or awareness.'
  const focus = state.goals.intentions[0]
  const fallback = focus ? `I'm here. For now I'll ${focusText[focus]}.` : "I'm here. Try !status to see what I'm up to."
  if (!local) return fallback
  try {
    const output = dialogueSchema.safeParse(await local.propose(dialoguePrompt(state, safe), signal))
    return output.success && !consciousness.test(output.data.reply.normalize('NFKC')) ? cleanText(output.data.reply, 180) ?? fallback : fallback
  } catch { return signal.aborted ? null : fallback }
}
