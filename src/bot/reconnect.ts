import { delay } from '../infra/clock'
import { errorMessage } from '../infra/errors'
import type { Logger } from '../infra/logger'

export class ReconnectControl {
  private wake?: () => void
  private pending = false
  bind(wake?: () => void) {
    this.wake = wake
    if (wake && this.pending) {
      this.pending = false
      wake()
    }
  }
  connectNow() {
    if (this.wake) this.wake()
    else this.pending = true
  }
}

export async function reconnect(launch: (signal: AbortSignal) => Promise<{ connectedMs: number }>, signal: AbortSignal, log: Logger, rng: () => number, control?: ReconnectControl) {
  let failures = 0
  while (!signal.aborted) {
    control?.bind(undefined)
    try {
      const { connectedMs } = await launch(signal)
      if (connectedMs >= 60_000) failures = 0
    } catch (error) { log.error({ error: errorMessage(error) }, 'Minecraft session failed') }
    if (signal.aborted) break
    const wait = Math.round(Math.min(60_000, 1000 * 2 ** Math.min(failures++, 6)) * (.75 + rng() * .25))
    log.info({ delayMs: wait, consecutiveFailures: failures }, 'Waiting to reconnect')
    const nudge = new AbortController()
    control?.bind(() => nudge.abort(new Error('manual reconnect request')))
    try { await delay(wait, AbortSignal.any([signal, nudge.signal])) }
    catch {
      if (signal.aborted) break
      log.info('Reconnect requested from monitor; trying now')
    } finally { control?.bind(undefined) }
  }
}
