import type { Bot } from 'mineflayer'
import { goals } from 'mineflayer-pathfinder'
import { delay } from '../infra/clock'
import { playerEntity } from '../bot/perception'

export async function followPlayer(bot: Bot, name: string, radius: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  const target = playerEntity(bot, name)
  if (!target || target.position.distanceTo(bot.entity.position) > radius) return
  const goal = new goals.GoalFollow(target, 2.5)
  bot.pathfinder.setGoal(goal, true)
  while (target.isValid && target.position.distanceTo(bot.entity.position) <= radius && bot.pathfinder.goal === goal) await delay(400, signal)
}
