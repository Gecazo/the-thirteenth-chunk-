import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { Memory, MemoryEvent } from '../types/memory'
import { salience } from '../brain/memory/salience'
import { ShortTermMemory } from '../brain/memory/shortTermMemory'
import { consolidateMemories } from '../brain/memory/longTermMemory'
import { retrieve } from '../brain/memory/retrieval'
import { clock } from './fixtures'

test('salience ranks harm above routine and newer events above equally intense older events', () => {
  const at = clock.now()
  const meal: MemoryEvent = { id: randomUUID(), at, day: 1, kind: 'ate', intensity: .6, valence: .6 }
  const damage: MemoryEvent = { ...meal, id: randomUUID(), kind: 'damage', valence: -.6 }
  assert.ok(salience(damage, at) > salience(meal, at))
  assert.ok(salience(meal, at) > salience({ ...meal, at: at - 40_000 }, at))
})

test('short-term ring preserves only the newest events and keeps day-specific order', () => {
  const stm = new ShortTermMemory(2, ['corrupt'])
  stm.record({ at: 1, day: 0, kind: 'joined', valence: 0, intensity: .2 })
  stm.record({ at: 2, day: 1, kind: 'ate', valence: .6, intensity: .2 })
  stm.record({ at: 3, day: 1, kind: 'slept', valence: .4, intensity: .2 })
  assert.deepEqual(stm.forDay(1).map(e => e.kind), ['ate', 'slept'])
  assert.deepEqual(stm.forDay(0), [])
})

test('long-term retrieval rewards topic overlap and emotional congruence', () => {
  const m: Memory = { id: '1', summary: 'A meal', kind: 'episodic', day: 1, at: clock.now(), salience: .4, valence: .6, topics: ['ate'] }
  const other: Memory = { ...m, id: '2', summary: 'A hard day', topics: ['danger'], valence: -.6 }
  assert.equal(retrieve([other, m], { topics: ['ate'], mood: .6, now: clock.now(), limit: 1 })[0]?.id, '1')
  assert.equal(retrieve([other, m], { topics: [], mood: -.6, now: clock.now(), limit: 1 })[0]?.id, '2')
})

test('sleep turns verified survival milestones into distinct episodic memories', () => {
  const stm = new ShortTermMemory(8)
  for (const milestone of ['home', 'iron_tools', 'home'] as const) {
    stm.record({ at: clock.now(), day: 1, kind: 'milestone', milestone, valence: .8, intensity: .75 })
  }
  const restored = new ShortTermMemory(8, stm.all())
  const milestones = consolidateMemories(restored.forDay(1), 1, clock.now(), []).filter(m => m.id.startsWith('survival:'))
  assert.deepEqual(milestones.map(m => m.id), ['survival:home', 'survival:iron_tools'])
  assert.match(milestones[0]?.summary ?? '', /Starter home/)
})
