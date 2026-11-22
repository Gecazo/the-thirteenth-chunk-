import type { Bot } from 'mineflayer'
import { goals } from 'mineflayer-pathfinder'
import { untilAbort } from '../infra/errors'
import { delay } from '../infra/clock'
import { safeFoods } from './eatIfHungry'

export async function gatherBasic(bot: Bot, id: number, signal: AbortSignal): Promise<boolean> {
  const entity = bot.entities[id], dropped = entity?.getDroppedItem()
  if (!entity?.isValid || !dropped || !safeFoods.has(dropped.name) || entity.position.distanceTo(bot.entity.position) > 8) return false
  const { x, y, z } = entity.position.floored()
  const before = bot.inventory.count(dropped.type, null)
  await untilAbort(bot.pathfinder.goto(new goals.GoalBlock(x, y, z)), signal)
  await delay(450, signal)
  return bot.inventory.count(dropped.type, null) > before
}
