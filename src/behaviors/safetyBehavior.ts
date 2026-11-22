import type { Bot } from 'mineflayer'
import { goals } from 'mineflayer-pathfinder'
import { delay } from '../infra/clock'
import { untilAbort } from '../infra/errors'
import { dangerousBlocks, vec } from '../bot/perception'
import type { PerceptionFrame } from '../types/decisions'

export async function safetyBehavior(bot: Bot, p: PerceptionFrame, signal: AbortSignal): Promise<void> {
  if (bot.isSleeping) await untilAbort(bot.wake(), signal)
  if (p.breath < 10) {
    bot.setControlState('jump', true)
    try { await delay(1400, signal) } finally { bot.setControlState('jump', false) }
    return
  }
  const start = bot.entity.position.clone()
  const mobPositions = p.hostiles.slice(0, 8).map(mob => vec(mob.position))
  const currentClearance = Math.min(...mobPositions.map(m => m.distanceTo(start)))
  const nearby = []
  for (const r of [5, 9, 13]) for (let d = 0; d < 8; d++) for (const dy of [0, 1, -1, -2, 2]) {
    const angle = d * Math.PI / 4
    const destination = start.offset(Math.round(r * Math.cos(angle)), dy, Math.round(r * Math.sin(angle))).floored()
    const foot = bot.blockAt(destination, false), head = bot.blockAt(destination.offset(0, 1, 0), false), ground = bot.blockAt(destination.offset(0, -1, 0), false)
    if (!foot || !head || !ground || foot.boundingBox !== 'empty' || head.boundingBox !== 'empty' || ground.boundingBox !== 'block') continue
    if ([foot, head, ground].some(b => dangerousBlocks.has(b.name) || b.name === 'water')) continue
    const clearance = Math.min(...mobPositions.map(m => m.distanceTo(destination)))
    if (mobPositions.length && clearance < currentClearance + 1.5) continue
    nearby.push({ destination, score: (mobPositions.length ? Math.min(clearance, 18) * 2 : 0) - r * .55 - Math.abs(dy) })
  }
  for (const { destination } of nearby.sort((a, b) => b.score - a.score).slice(0, 8)) {
    signal.throwIfAborted()
    const goal = new goals.GoalBlock(destination.x, destination.y, destination.z)
    const path = bot.pathfinder.getPathTo(bot.pathfinder.movements, goal, 25)
    if (path.status !== 'success' || path.path.some(node => mobPositions.some(m => m.distanceTo(vec(node)) < Math.min(3, currentClearance - .25)))) continue
    await untilAbort(bot.pathfinder.goto(goal), signal)
    return
  }
  // No route is safer than blindly running through a drop or an obstacle.
  await delay(450, signal)
}
