import assert from 'node:assert/strict'
import test from 'node:test'
import { parseConfig } from '../config'
import { defaultState } from '../types/state'
import { ActionBudget } from '../brain/policies/actionBudget'
import { decide } from '../brain/decisionEngine'
import { updateNeeds } from '../brain/needs'
import { shouldInterrupt } from '../brain/interruptionPolicy'
import { frame, clock } from './fixtures'

const config = parseConfig()

test('chooses follow, hunger, and forced retreat in deterministic priority order', () => {
  const s = defaultState('SoulBot', clock.now()), budget = new ActionBudget()
  s.runtime.following = 'Friend'
  const p = frame({ followVisible: true })
  const choose = () => { updateNeeds(s, p, 1); return decide(s, p, config, budget).chosen }
  assert.equal(choose().action, 'FOLLOW_PLAYER')
  p.food = 6; p.inventory.foodCount = 2
  assert.equal(choose().action, 'EAT')
  p.hostiles = [{ id: 42, name: 'creeper', distance: 4, position: { x: 4, y: 64, z: 0 } }]
  assert.equal(choose().action, 'RETREAT_TO_SAFETY')
  budget.defer('RETREAT_TO_SAFETY', p.at, 1000)
  assert.equal(choose().action, 'STOP')
})

test('chooses approach versus sleep, and rejects bed use outside the Overworld', () => {
  const s = defaultState('SoulBot', clock.now()), budget = new ActionBudget()
  s.runtime.sleepRequested = true
  const p = frame({ timeOfDay: 13000, beds: [{ x: 10, y: 64, z: 0 }] })
  assert.equal(decide(s, p, config, budget).chosen.action, 'SEEK_BED')
  p.position.x = 9
  assert.equal(decide(s, p, config, budget).chosen.action, 'SLEEP')
  p.dimension = 'the_nether'
  const d = decide(s, p, config, budget)
  assert.equal(d.candidates.find(c => c.action === 'SLEEP')?.eligible, false)
  assert.equal(d.candidates.find(c => c.action === 'SEEK_BED')?.eligible, false)
})

test('pause and incapacitation block routine behavior; emergencies interrupt consumption', () => {
  const s = defaultState('SoulBot', clock.now()), budget = new ActionBudget()
  s.runtime.paused = true
  assert.equal(decide(s, frame(), config, budget).chosen.action, 'STOP')
  assert.equal(decide(s, frame({ hazard: 'fire' }), config, budget).chosen.action, 'RETREAT_TO_SAFETY')
  assert.equal(decide(s, frame({ health: 0, hazard: 'fire' }), config, budget).chosen.action, 'STOP')
  assert.equal(shouldInterrupt('EAT', 'RETREAT_TO_SAFETY'), true)
  assert.equal(shouldInterrupt('EAT', 'FOLLOW_PLAYER'), false)
})

test('an un-attributed starvation tick does not block food, but a known threat still wins', () => {
  const s = defaultState('SoulBot', clock.now()), budget = new ActionBudget()
  const p = frame({ health: 3, food: 0, lastDamage: { at: clock.now(), source: 'possible starvation', environmentalNeed: true } })
  p.inventory.foodCount = 2
  updateNeeds(s, p, 1)
  assert.equal(decide(s, p, config, budget).chosen.action, 'EAT')
  p.lastDamage = { at: clock.now(), source: 'skeleton' }
  updateNeeds(s, p, 1)
  assert.equal(decide(s, p, config, budget).chosen.action, 'RETREAT_TO_SAFETY')
})

test('autonomous work is opt-in and yields to pause, manual work, hunger, sleep and danger', () => {
  const s = defaultState('SoulBot', clock.now()), budget = new ActionBudget()
  const enabled = parseConfig({ AUTONOMY_ENABLED: 'true' })
  const choose = (p = frame()) => { updateNeeds(s, p, 1); return decide(s, p, enabled, budget).chosen.action }
  assert.equal(decide(s, frame(), config, budget).candidates.find(c => c.action === 'AUTONOMOUS')?.eligible, false)
  assert.equal(choose(), 'AUTONOMOUS')
  assert.notEqual(choose(frame({ dimension: 'the_nether' })), 'AUTONOMOUS')
  s.runtime.following = 'Friend'
  assert.equal(choose(frame({ followVisible: true })), 'FOLLOW_PLAYER')
  assert.notEqual(choose(), 'AUTONOMOUS')
  s.runtime.following = null
  s.runtime.sleepRequested = true
  assert.notEqual(choose(), 'AUTONOMOUS')
  assert.equal(choose(frame({ timeOfDay: 13000, beds: [{ x: 10, y: 64, z: 0 }] })), 'SEEK_BED')
  s.runtime.sleepRequested = false
  assert.equal(choose(frame({ food: 6, inventory: { occupiedSlots: 1, foodCount: 2, items: { bread: 2 } } })), 'EAT')
  assert.equal(choose(frame({ hazard: 'fire' })), 'RETREAT_TO_SAFETY')
  s.runtime.paused = true
  assert.equal(choose(), 'STOP')
  for (const action of ['FOLLOW_PLAYER', 'SEEK_BED', 'SLEEP', 'EAT', 'RETREAT_TO_SAFETY', 'STOP'] as const) {
    assert.equal(shouldInterrupt('AUTONOMOUS', action), true, action)
  }
})

test('nightly sleep request can trigger bed seeking even below sleep-debt threshold', () => {
  const s = defaultState('SoulBot', clock.now()), budget = new ActionBudget()
  s.circadian.lastSleepDay = 1
  s.needs.sleepDebt = 5
  const nightly = parseConfig({ SLEEP_EVERY_NIGHT: 'true' })
  const p = frame({ day: 2, timeOfDay: 13000, beds: [{ x: 8, y: 64, z: 0 }] })
  updateNeeds(s, p, 1)
  assert.equal(decide(s, p, nightly, budget).chosen.action, 'SEEK_BED')
  const debtOnly = parseConfig({ SLEEP_EVERY_NIGHT: 'false', SLEEP_TRIGGER: '60' })
  assert.notEqual(decide(s, p, debtOnly, budget).chosen.action, 'SEEK_BED')
})

test('idle social is ineligible when nobody is nearby', () => {
  const s = defaultState('SoulBot', clock.now()), budget = new ActionBudget()
  const enabled = parseConfig({ AUTONOMY_ENABLED: 'true' })
  const p = frame({ players: [] })
  updateNeeds(s, p, 1)
  const d = decide(s, p, enabled, budget)
  assert.equal(d.candidates.find(c => c.action === 'IDLE_SOCIAL')?.eligible, false)
  assert.equal(d.chosen.action, 'AUTONOMOUS')
})

test('autonomous remains the best eligible action while not paused', () => {
  const s = defaultState('SoulBot', clock.now()), budget = new ActionBudget()
  const enabled = parseConfig({ AUTONOMY_ENABLED: 'true' })
  const p = frame({ players: [], hostiles: [], beds: [] })
  updateNeeds(s, p, 1)
  const d = decide(s, p, enabled, budget)
  assert.equal(d.chosen.action, 'AUTONOMOUS')
  assert.equal(d.candidates.find(c => c.action === 'STOP')?.eligible, true)
  assert.equal(d.candidates.find(c => c.action === 'AUTONOMOUS')?.eligible, true)
})
