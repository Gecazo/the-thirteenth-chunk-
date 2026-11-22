import type { Advisor } from '../types/llm'
import { delay } from '../infra/clock'

export interface Providers { local?: Advisor; cloud?: Advisor }

// One retry for transient transport/HTTP failures, under a single total deadline.
export async function requestJson(url: string, body: unknown, headers: Record<string, string>, timeout: number, parent: AbortSignal, retry: boolean): Promise<unknown> {
  const signal = AbortSignal.any([parent, AbortSignal.timeout(timeout)])
  for (let attempt = 0; ; attempt++) {
    let status: number | undefined
    try {
      const res = await fetch(url, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers }, redirect: 'error', signal })
      status = res.status
      if (!res.ok) { await res.body?.cancel(); throw new Error(`Model endpoint returned HTTP ${status}`) }
      const reader = res.body?.getReader()
      if (!reader) throw new Error('Empty model response')
      const decoder = new TextDecoder()
      let text = '', size = 0
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        size += chunk.value.byteLength
        if (size > 64 * 1024) { await reader.cancel(); throw new Error('Model response exceeded size limit') }
        text += decoder.decode(chunk.value, { stream: true })
      }
      return JSON.parse(text + decoder.decode()) as unknown
    } catch (e) {
      if (!retry || attempt > 0 || signal.aborted || (status !== undefined && status !== 429 && status < 500)) throw e
      await delay(250, signal)
    }
  }
}

export function parseModelObject(text: string): unknown {
  if (text.length > 8192) throw new Error('Model content exceeded size limit')
  try { return JSON.parse(text) as unknown } catch { throw new Error('Model content was not JSON') }
}
