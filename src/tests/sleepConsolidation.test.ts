import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseConfig } from '../config'
import { StateEngine } from '../brain/stateEngine'
import { ShortTermMemory } from '../brain/memory/shortTermMemory'
import { consolidateSleep } from '../brain/sleep/sleepConsolidation'
import { openSoulFile } from '../storage/soulFile'
import { parseSoulDocument } from '../storage/soulDocument'
import { SleepRepo } from '../storage/repositories/sleepRepo'
import { MemoryRepo } from '../storage/repositories/memoryRepo'
import { clock, frame, log } from './fixtures'
import { learnSkills, skillRank } from '../brain/survival/skills'
import { Vec3 } from 'vec3'
import { editPlayerNote, recallContext } from '../brain/memory/journal'

test('soul.md integration accepts gated cloud advice, persists STM, audit and identity, and deduplicates', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'soulbot-test-')), path = join(dir, 'soul.md')
  try {
    const storage = openSoulFile(path)
    const engine = new StateEngine(undefined, 'SoulBot', clock, log), stm = new ShortTermMemory(20)
    const config = parseConfig({ CLOUD_SLEEP_ENABLED: 'true', CLOUD_API_KEY: 'test-only' })
    const repo = new SleepRepo(storage), identity = engine.get().identity
    stm.record({ kind: 'damage', day: 3, at: 1, intensity: .8, valence: -.7, area: 'overworld:1,4,-1' })
    engine.update(s => {
      s.circadian.sleeping = true; s.circadian.day = 3; s.goals.userGoal = 'secret-goal'; s.social = [{ player: 'SecretFriend', trust: .5, lastSeen: 1 }]
      s.journal = editPlayerNote(s.journal, 'Alex', 'I prefer oak shelters')!
    })
    const ctx = { config, clock, log, engine, stm, repo, providers: {
      local: { async propose() { return { memoryFocus: 'stay_safe' } } },
      cloud: { async propose(prompt: { user: string }) {
        assert.doesNotMatch(prompt.user, /SecretFriend|secret-goal|overworld|SoulBot|Alex|oak shelters|journalCandidates/)
        engine.update(s => { s.goals.userGoal = 'Operator edit during sleep' })
        return { traitDeltas: { caution: .01 }, trustDeltas: [{ slot: 0, delta: .02 }], intentions: ['stay_safe', 'rest'] }
      } },
    } }
    try {
      const signal = new AbortController().signal
      assert.equal((await consolidateSleep(ctx, 3, signal))?.source, 'cloud')
      assert.equal(await consolidateSleep(ctx, 3, signal), null)
      assert.equal(engine.get().goals.userGoal, 'Operator edit during sleep')
      assert.ok(new MemoryRepo(storage).list().some(m => m.kind === 'danger'))
    } finally { storage.close() }
    const reopened = openSoulFile(path)
    try {
      const persisted = reopened.load(), fresh = new StateEngine(persisted.state, 'Other', clock, log).get()
      assert.deepEqual(fresh.identity, identity)
      assert.equal(fresh.circadian.sleeping, false)
      assert.equal(fresh.circadian.lastSleepDay, 3)
      assert.equal(fresh.social[0]?.trust, .52)
      assert.deepEqual(fresh.goals.intentions, ['stay_safe', 'rest'])
      assert.equal(persisted.events.length, 1)
      assert.equal(reopened.slept(3), true)
      assert.ok(new MemoryRepo(reopened).list().some(m => m.kind === 'danger'))
    } finally { reopened.close() }
    const document = readFileSync(path, 'utf8')
    assert.match(document, /## Current intentions\n\n- keep to safer routes\./)
    const snapshot = parseSoulDocument(document)
    assert.equal(snapshot.audit.length, 1)
    assert.equal(snapshot.sleeps['3']?.source, 'cloud')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('invalid cloud result uses deterministic fallback even if local advice is valid', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'soulbot-rejected-'))
  const storage = openSoulFile(join(dir, 'soul.md'))
  try {
    const engine = new StateEngine(undefined, 'SoulBot', clock, log), stm = new ShortTermMemory(20)
    const initial = engine.get()
    const ctx = { config: parseConfig({ CLOUD_SLEEP_ENABLED: 'true', CLOUD_API_KEY: 'test-only' }), clock, log, engine, stm, repo: new SleepRepo(storage), providers: {
      local: { async propose() { return { intentions: ['rest'] } } },
      cloud: { async propose() { return { traitDeltas: { caution: .8 } } } },
    } }
    const signal = new AbortController().signal
    assert.equal(await consolidateSleep(ctx, 1, signal), null)
    engine.update(s => { s.circadian.sleeping = true })
    const record = await consolidateSleep(ctx, 1, signal)
    assert.equal(record?.source, 'deterministic')
    assert.match(record?.rejections[0] ?? '', /trait drift/)
    assert.deepEqual(engine.get().personality, initial.personality)
    assert.notDeepEqual(record?.intentions, ['rest'])
    assert.equal(new MemoryRepo(storage).list().length, 1)
  } finally { storage.close(); rmSync(dir, { recursive: true, force: true }) }
})

test('unavailable cloud still produces deterministic consolidation', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'soulbot-unavailable-'))
  const storage = openSoulFile(join(dir, 'soul.md'))
  try {
    const engine = new StateEngine(undefined, 'SoulBot', clock, log), stm = new ShortTermMemory(20)
    engine.update(s => { s.circadian.sleeping = true })
    const ctx = { config: parseConfig({ CLOUD_SLEEP_ENABLED: 'true', CLOUD_API_KEY: 'test-only' }), clock, log, engine, stm, repo: new SleepRepo(storage), providers: {
      local: { async propose() { return { intentions: ['rest'] } } },
      cloud: { async propose() { throw new Error('Unavailable') } },
    } }
    const record = await consolidateSleep(ctx, 1, new AbortController().signal)
    assert.equal(record?.source, 'deterministic')
    assert.match(record?.rejections[0] ?? '', /unavailable/)
    assert.notDeepEqual(record?.intentions, ['rest'])
  } finally { storage.close(); rmSync(dir, { recursive: true, force: true }) }
})

test('waking cancels pending advice but saves fallback; session abort does not commit', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'soulbot-wake-')), path = join(dir, 'soul.md')
  try {
    const storage = openSoulFile(path), engine = new StateEngine(undefined, 'SoulBot', clock, log), stm = new ShortTermMemory(20)
    engine.update(s => { s.circadian.sleeping = true })
    const ctx = { config: parseConfig(), clock, log, engine, stm, repo: new SleepRepo(storage), providers: { local: { propose: () => new Promise<never>(() => {}) } } }
    const session = new AbortController(), wake = new AbortController()
    const run = consolidateSleep(ctx, 1, session.signal, wake.signal)
    engine.update(s => { s.circadian.sleeping = false }); wake.abort()
    assert.equal((await run)?.source, 'deterministic')
    assert.equal(engine.get().circadian.sleeping, false)
    engine.update(s => { s.circadian.sleeping = true }); session.abort()
    assert.equal(await consolidateSleep(ctx, 2, session.signal), null)
    assert.equal(storage.slept(2), false)
    storage.close()
    const reopened = openSoulFile(path)
    try { assert.equal(reopened.slept(1), true) } finally { reopened.close() }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('sleep reviews missed nights and saves both a reusable rule and a journal entry across restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'soulbot-skills-')), path = join(dir, 'soul.md')
  const storage = openSoulFile(path)
  try {
    const engine = new StateEngine(undefined, 'SoulBot', clock, log), stm = new ShortTermMemory(20)
    for (const [success, distance] of [[true, 4], [false, 18]] as const) stm.record({
      at: 1, day: 4, kind: 'work_outcome', valence: success ? .4 : -.35, intensity: .5, work: { kind: 'tree', success, distance },
    })
    engine.update(s => { s.circadian.sleeping = true })
    const ctx = { config: parseConfig(), clock, log, engine, stm, repo: new SleepRepo(storage), providers: {
      local: { async propose(prompt: { user: string }) {
        assert.match(prompt.user, /"kind":"tree","successes":1,"failures":1/)
        assert.match(prompt.user, /experience:4:tree/)
        engine.update(s => { s.journal = editPlayerNote(s.journal, 'Alex', 'I prefer oak shelters')! })
        return { lessons: [{ kind: 'tree', rule: 'nearest' }], keepNotes: ['experience:4:tree'] }
      } },
    } }
    assert.equal((await consolidateSleep(ctx, 5, new AbortController().signal))?.source, 'local')
    storage.close()
    const reopened = openSoulFile(path)
    try {
      const state = new StateEngine(reopened.load().state, 'SoulBot', clock, log).get()
      assert.deepEqual(state.skills.tree, { rule: 'nearest', day: 5, successes: 1, failures: 1 })
      assert.equal(state.journal.day, 5)
      assert.match(state.journal.notes[0]?.text ?? '', /Tree harvest on day 4/)
      assert.ok(new MemoryRepo(reopened).list().some(m => m.id === 'experience:4:tree'))
      assert.equal(recallContext(state, [], clock.now(), 'trees', 'alex').playerNote, 'I prefer oak shelters')
      assert.equal(recallContext(state, [], clock.now(), 'trees', 'Birch').playerNote, undefined)
      const job = (x: number) => ({ kind: 'tree' as const, label: 'Harvest tree', pos: new Vec3(x, 64, 0) })
      assert.ok(skillRank(state.skills, job(4), frame(), 5) > skillRank(state.skills, job(18), frame(), 5))
      assert.equal(skillRank(state.skills, job(4), frame(), 13), 0)
    } finally { reopened.close() }
  } finally { storage.close(); rmSync(dir, { recursive: true, force: true }) }
})

test('skill learning rejects unobserved actions, unsupported rules and executable text', () => {
  const evidence = [{ kind: 'tree' as const, successes: 1, failures: 0, nearSuccesses: 1, farFailures: 0 }]
  for (const proposal of [
    [{ kind: 'walk', rule: 'prefer' }], [{ kind: 'tree', rule: 'nearest' }],
    [{ kind: 'tree', rule: 'prefer', code: 'run()' }],
  ]) assert.equal(learnSkills(proposal, {}, evidence, 4), null)
  assert.deepEqual(learnSkills([{ kind: 'tree', rule: 'prefer' }, { kind: 'tree', rule: 'defer' }], {}, evidence, 4),
    { tree: { rule: 'prefer', day: 4, successes: 1, failures: 0 } })
})
