import { z } from 'zod'
import type { Config } from '../config'
import type { Advisor } from '../types/llm'
import { parseModelObject, requestJson } from './providerRouter'

const envelope = z.object({ choices: z.tuple([z.object({ message: z.object({ content: z.string() }) })]).rest(z.unknown()) })
export function cloudClient(config: Config): Advisor {
  return { async propose(prompt, signal) {
    const result = await requestJson(`${config.CLOUD_BASE_URL}/chat/completions`, {
      model: config.CLOUD_MODEL, stream: false, max_tokens: 384, temperature: .2,
      ...(config.CLOUD_PROVIDER === 'compatible' ? {} : { response_format: { type: 'json_object' } }),
      messages: [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }],
    }, { authorization: `Bearer ${config.CLOUD_API_KEY}` }, config.CLOUD_TIMEOUT_MS, signal, true)
    return parseModelObject(envelope.parse(result).choices[0].message.content)
  } }
}
