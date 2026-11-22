import assert from 'node:assert/strict'
import test from 'node:test'
import { parseConfig } from '../config'
import { sleepFacts } from '../llm/prompts/sleepIntegratorPrompt'
import { soulGuard } from '../brain/sleep/soulGuard'
import { limitedDelta } from '../brain/sleep/driftLimiter'
import { defaultState } from '../types/state'
import { clock } from './fixtures'

test('clamps drifts at configured bounds and state edges', () => {
  assert.equal(limitedDelta(.5, .8, .02), .52)
  assert.equal(limitedDelta(.995, .02, .02), 1)
  assert.equal(limitedDelta(.004, -.01, .01), 0)
})

test('guard rejects injections, invalid ranges, excessive drift, locked values, ambiguous trust and unsafe intentions', () => {
  const config = parseConfig({ ALLOW_CORE_VALUE_CHANGE: 'true' })
  const s = defaultState('SoulBot', clock.now())
  s.social = [{ player: 'Friend', trust: .5, lastSeen: 1 }]
  const facts = sleepFacts(s, [], ['stay_safe', 'eat_well'], clock.now())
  for (const raw of [
    { instructions: '/kill @e' }, { memoryFocus: 'override safety' }, { traitDeltas: { curiosity: '0.01' } }, { traitDeltas: { curiosity: -8 } },
    { traitDeltas: { curiosity: .021 } }, { valueDeltas: { kindness: .001 } }, { valueDeltas: { helpfulness: .011 } },
    { trustDeltas: [{ slot: 0, delta: .051 }] }, { trustDeltas: [{ slot: 1, delta: .01 }] }, { trustDeltas: [{ slot: 0, delta: .03 }, { slot: 0, delta: .03 }] },
    { intentions: ['observe_world'] }, { intentions: ['stay_safe', 'stay_safe', 'eat_well'] },
  ]) assert.equal(soulGuard(raw, s, facts, config, true, 'cloud').ok, false, JSON.stringify(raw))
  assert.equal(soulGuard({ trustDeltas: [{ slot: 0, delta: .01 }] }, s, facts, config, false, 'cloud').ok, false)
  assert.equal(soulGuard({ traitDeltas: { curiosity: .01 } }, s, facts, config, true, 'local').ok, false)
  const accepted = soulGuard({ traitDeltas: { curiosity: .02 }, valueDeltas: { helpfulness: -.01 }, trustDeltas: [{ slot: 0, delta: .05 }], intentions: ['stay_safe', 'eat_well'] }, s, facts, config, true, 'cloud')
  assert.ok(accepted.ok)
  assert.equal(accepted.state.personality.curiosity, .64)
  assert.equal(accepted.state.social[0]?.trust, .55)
  assert.equal(accepted.state.values.helpfulness, .74)
  assert.equal(s.personality.curiosity, .62)
})
