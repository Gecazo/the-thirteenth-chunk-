import type { Bot } from 'mineflayer'
import { goals } from 'mineflayer-pathfinder'
import { bedFree, vec } from '../bot/perception'
import { untilAbort } from '../infra/errors'
import type { Point } from '../types/decisions'
import { bedHours, overworld } from '../brain/sleep/sleepTrigger'

export function selectEmptyHand(bot: Bot): boolean {
  // A rejected block interaction can otherwise fall through to using the held item.
  const start = bot.inventory.hotbarStart
  if (bot.inventory.slots[start + 9]) return false // off-hand slot in supported Minecraft versions
  if (!bot.heldItem) return true
  for (let slot = 0; slot < 9; slot++) if (!bot.inventory.slots[start + slot]) {
    bot.setQuickBarSlot(slot)
    return true
  }
  return false
}

export async function findBedAndSleep(bot: Bot, points: Point[], seek: boolean, signal: AbortSignal): Promise<void> {
  const failures: unknown[] = []
  for (const point of points.slice(0, 3)) {
    signal.throwIfAborted()
    // Never interact with beds in dimensions where beds explode.
    if (!overworld(bot.game.dimension) || !bedHours({ timeOfDay: bot.time.timeOfDay, thunder: bot.isRaining && bot.thunderState > 0 })) return
    const bed = bedFree(bot, point)
    if (!bed) continue
    try {
      if (seek || !bot.canDigBlock(bed)) {
        const { x, y, z } = vec(point)
        // Aim at a reachable point near the head, then verify actual interaction range.
        await untilAbort(bot.pathfinder.goto(new goals.GoalNear(x, y, z, 1)), signal)
      }
      signal.throwIfAborted()
      const fresh = bedFree(bot, point)
      if (!overworld(bot.game.dimension) || !fresh || !bot.canDigBlock(fresh)) continue
      if (!selectEmptyHand(bot)) throw new Error('Bed interaction requires empty main and off hands')
      await untilAbort(bot.sleep(fresh), signal)
      return
    } catch (error) {
      if (signal.aborted) throw error
      failures.push(error)
    }
  }
  if (failures.length) throw failures[0]
  throw new Error('No usable in-reach bed')
}
