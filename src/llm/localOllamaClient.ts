import { z } from 'zod'
import type { Config } from '../config'
import type { Advisor } from '../types/llm'
import { parseModelObject, requestJson } from './providerRouter'

const ollamaEnvelope = z.object({ message: z.object({ content: z.string() }) })
export function ollamaClient(config: Config): Advisor {
  return { async propose(prompt, signal) {
    const result = await requestJson(`${config.OLLAMA_BASE_URL}/api/chat`, {
      model: config.OLLAMA_MODEL, stream: false, think: false, keep_alive: '5m', format: prompt.format ?? 'json',
      options: { temperature: .2, num_predict: prompt.tokenBudget ?? 240, num_ctx: config.OLLAMA_CONTEXT },
      messages: [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user, ...(prompt.image ? { images: [prompt.image] } : {}) }],
    }, {}, config.OLLAMA_TIMEOUT_MS, signal, false)
    return parseModelObject(ollamaEnvelope.parse(result).message.content)
  } }
}

const openAiEnvelope = z.object({ choices: z.tuple([z.object({ message: z.object({ content: z.string() }) })]).rest(z.unknown()) })

// OpenAI Chat Completions on a local engine (colibrì, llama.cpp, vLLM…). Same wire format
// as the cloud client; the only difference is no API key and no server-managed JSON mode.
export function openAiLocalClient(config: Config): Advisor {
  return { async propose(prompt, signal) {
    const result = await requestJson(`${config.LOCAL_OPENAI_BASE_URL}/chat/completions`, {
      model: config.LOCAL_OPENAI_MODEL, stream: false, max_tokens: 384, temperature: .2,
      messages: [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }],
    }, {}, config.LOCAL_OPENAI_TIMEOUT_MS, signal, true)
    return parseModelObject(openAiEnvelope.parse(result).choices[0].message.content)
  } }
}
