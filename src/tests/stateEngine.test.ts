import assert from 'node:assert/strict'
import test from 'node:test'
import { StateEngine, recoverState } from '../brain/stateEngine'
import { feel, decayEmotions } from '../brain/emotions'
import { stateSchema, defaultState } from '../types/state'
import { clock, log } from './fixtures'

test('clamps numeric updates, enforces invariants, and protects identity and reference boundaries', () => {
  const engine = new StateEngine(undefined, 'SoulBot', clock, log), initial = engine.get()
  engine.update(s => { s.identity.name = 'Changed'; s.emotions.joy = 8; s.needs.energy = -10; s.vitals.health = 22 })
  const state = engine.get()
  assert.deepEqual(state.identity, initial.identity)
  assert.equal(state.emotions.joy, 1); assert.equal(state.needs.energy, 0); assert.equal(state.vitals.health, 20)
  state.emotions.joy = 0
  assert.equal(engine.get().emotions.joy, 1)
  assert.throws(() => engine.update(s => { s.runtime.paused = true; s.runtime.following = 'Friend' }))
  assert.equal(engine.get().runtime.paused, false)
})

test('heals malformed state without discarding a valid identity', () => {
  const initial = defaultState('SoulBot', clock.now())
  const recovered = recoverState({ ...initial, needs: { energy: -2 }, social: [{ player: 'Friend', trust: 3, lastSeen: 1 }, { player: 'friend', trust: .1, lastSeen: 4 }], goals: false }, 'Other', clock.now(), log)
  assert.equal(recovered.identity.id, initial.identity.id)
  assert.equal(recovered.needs.energy, 0)
  assert.deepEqual(recovered.social, [{ player: 'Friend', trust: 1, lastSeen: 1 }])
  assert.equal(stateSchema.safeParse(recovered).success, true)
})

test('damage raises fear and lowers calm before gradual decay', () => {
  const { emotions } = defaultState('SoulBot', clock.now())
  feel(emotions, 'damage', 1)
  assert.ok(emotions.fear > .6 && emotions.calm < .3)
  decayEmotions(emotions, 65)
  assert.ok(emotions.fear < .4 && emotions.fear > .08 && emotions.calm > .3)
  feel(emotions, 'company', 1)
  assert.ok(emotions.joy > .4)
})
