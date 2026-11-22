import type { Bot } from 'mineflayer'
import { untilAbort } from '../infra/errors'
import { delay } from '../infra/clock'

// Only ordinary foods; reject special effects, unsafe foods, and bottles.
export const safeFoods = new Set(['apple', 'baked_potato', 'beetroot', 'beetroot_soup', 'bread', 'carrot', 'cooked_beef',
  'cooked_chicken', 'cooked_cod', 'cooked_mutton', 'cooked_porkchop', 'cooked_rabbit', 'cooked_salmon', 'cookie',
  'dried_kelp', 'golden_carrot', 'melon_slice', 'mushroom_stew', 'potato', 'pumpkin_pie', 'rabbit_stew', 'sweet_berries'])

export async function eatIfHungry(bot: Bot, signal: AbortSignal): Promise<boolean> {
  if (bot.food >= 20) return false
  const gap = 20 - bot.food
  const food = bot.inventory.items().filter(item => safeFoods.has(item.name) && bot.registry.foodsByName[item.name])
    .map(item => {
      const data = bot.registry.foodsByName[item.name]!
      return { item, score: Math.min(gap, data.foodPoints) + data.saturation * .25 - Math.max(0, data.foodPoints - gap) * .4 }
    }).sort((a, b) => b.score - a.score || a.item.slot - b.item.slot)[0]?.item
  if (!food) return false
  await untilAbort(bot.equip(food, 'hand'), signal)
  signal.throwIfAborted()
  const before = bot.inventory.count(food.type, null)
  try {
    await untilAbort(bot.consume(), signal)
    // The server's use-complete event can arrive before its health and inventory updates.
    for (let i = 0; i < 8; i++) {
      if (bot.inventory.count(food.type, null) < before) return true
      await delay(100, signal)
    }
    return false
  } finally {
    if (signal.aborted) bot.deactivateItem()
  }
}
