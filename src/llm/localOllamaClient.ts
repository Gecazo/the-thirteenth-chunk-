import { z } from 'zod'
import type { Config } from '../config'
import type { Advisor } from '../types/llm'
import { parseModelObject, requestJson } from './providerRouter'

const envelope = z.object({ message: z.object({ content: z.string() }) })
export function ollamaClient(config: Config): Advisor {
  return { async propose(prompt, signal) {
    const result = await requestJson(`${config.OLLAMA_BASE_URL}/api/chat`, {
      model: config.OLLAMA_MODEL, stream: false, think: false, keep_alive: '5m', format: prompt.format ?? 'json',
      options: { temperature: .2, num_predict: prompt.tokenBudget ?? 240, num_ctx: config.OLLAMA_CONTEXT },
      messages: [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user, ...(prompt.image ? { images: [prompt.image] } : {}) }],
    }, {}, config.OLLAMA_TIMEOUT_MS, signal, false)
    return parseModelObject(envelope.parse(result).message.content)
  } }
}
