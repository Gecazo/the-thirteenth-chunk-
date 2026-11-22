import type { Bot } from 'mineflayer'

export function stopBehavior(bot: Bot): void {
  bot.pathfinder.setGoal(null)
  bot.clearControlStates()
}
