import type { Bot } from 'mineflayer'
import { delay } from '../infra/clock'
import { untilAbort } from '../infra/errors'

export async function idleHumanizer(bot: Bot, rng: () => number, signal: AbortSignal): Promise<void> {
  await delay(280 + rng() * 900, signal)
  if (rng() < .65 && !bot.isSleeping) await untilAbort(bot.look(bot.entity.yaw + (rng() - .5) * .85, (rng() - .5) * .24), signal)
  await delay(1000 + rng() * 1700, signal)
}
