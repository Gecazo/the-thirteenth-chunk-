import assert from 'node:assert/strict'
import test from 'node:test'
import type { Bot } from 'mineflayer'
import { isFreeBedHead } from '../bot/perception'
import { eatIfHungry } from '../behaviors/eatIfHungry'
import { selectEmptyHand } from '../behaviors/findBedAndSleep'

test('bed search can classify Mineflayer palette blocks without world positions', () => {
  const bot = { isABed: () => true } as unknown as Bot
  const block = (part: string, occupied: boolean) => ({ position: null, getProperties: () => ({ part, occupied }) }) as unknown as NonNullable<ReturnType<Bot['blockAt']>>
  assert.equal(isFreeBedHead(bot, block('head', false)), true)
  assert.equal(isFreeBedHead(bot, block('foot', false)), false)
  assert.equal(isFreeBedHead(bot, block('head', true)), false)
  assert.equal(isFreeBedHead(bot, null), false)
})

test('eating confirms consumption from inventory even if the completion event arrives first', async () => {
  let count = 2
  const bread = { name: 'bread', type: 15, slot: 32 }
  const bot = { food: 5, inventory: { items: () => [bread], count: () => count },
    registry: { foodsByName: { bread: { foodPoints: 5, saturation: 6 } } }, equip: async () => {},
    async consume() { setTimeout(() => count--, 25) },
  } as unknown as Bot
  assert.equal(await eatIfHungry(bot, new AbortController().signal), true)
  assert.equal(count, 1)
})

test('bed interaction selects an empty hotbar slot and refuses an occupied off-hand', () => {
  const item = { name: 'stone' }, slots = Array<unknown>(46).fill(null)
  let selection = -1
  slots[36] = item
  const bot = { inventory: { hotbarStart: 36, slots }, heldItem: item, setQuickBarSlot: (i: number) => { selection = i } } as unknown as Bot
  assert.equal(selectEmptyHand(bot), true)
  assert.equal(selection, 1)
  slots[45] = item
  assert.equal(selectEmptyHand(bot), false)
})
