import assert from 'node:assert/strict'
import test from 'node:test'
import { curateNotes, editPlayerNote, recallContext, recallHistory, reviewCandidates } from '../brain/memory/journal'
import { searchHistory } from '../brain/memory/retrieval'
import { ShortTermMemory } from '../brain/memory/shortTermMemory'
import { dialoguePrompt } from '../llm/prompts/dialoguePrompt'
import type { Memory } from '../types/memory'
import { emptyJournal } from '../types/journal'
import { defaultState } from '../types/state'

const tree: Memory = { id: 'experience:4:tree', at: 12, day: 4, kind: 'episodic', topics: ['tree'], summary: 'Tree harvest worked near home.', valence: .5, salience: .6 }

test('recalls older experiences by topic without dumping the archive into prompts', () => {
  const state = defaultState('Adam', 1), archive = [{ ...tree, id: 'sleep', summary: 'Slept at home.', topics: ['rest'], at: 50 }, tree]
  assert.deepEqual(searchHistory(archive, 'Tell me about trees'), [tree])
  assert.deepEqual(searchHistory(archive, 'diamond'), [])
  state.journal = editPlayerNote(emptyJournal(), 'Alex', 'I prefer oak shelters')!
  const recall = recallContext(state, archive, 100, 'trees', 'ALEX')
  assert.deepEqual(recall.rememberedEvents, [{ day: 4, text: tree.summary }])
  assert.match(dialoguePrompt(state, 'trees', { recall }).user, /oak shelters/)
  assert.doesNotMatch(JSON.stringify(recallContext(state, archive, 100, 'trees')), /oak shelters/)
  assert.equal(editPlayerNote(state.journal, 'Alex', 'My password is secret'), null)
  assert.deepEqual(editPlayerNote(state.journal, 'alex')?.players, [])
})

test('curation keeps only offered notes, favors fresh observations, and bounds context', () => {
  const journal = emptyJournal()
  journal.notes = [{ id: tree.id, text: 'Older entry.' }]
  const candidates = reviewCandidates(journal, [tree], [])
  assert.deepEqual(candidates, [{ id: tree.id, text: tree.summary }])
  assert.equal(curateNotes(journal, candidates, ['invented'], 4), null)
  assert.equal(curateNotes(journal, candidates, [tree.id, tree.id], 4), null)
  const long = Array.from({ length: 12 }, (_, index) => ({ id: String(index), text: `${index}:`.padEnd(260, 't') }))
  const curated = curateNotes(journal, long, long.map(note => note.id), 4)!
  assert.equal(curated.notes.length, 8)
  const state = { ...defaultState('Adam', 1), journal: curated }
  assert.ok(recallContext(state, [], 100, '').notes.join('').length <= 880)
})

test('recent unreviewed work can be recalled before the first successful sleep', () => {
  const state = defaultState('Adam', 1), stm = new ShortTermMemory(20)
  stm.record({ at: 1, day: 4, kind: 'work_outcome', intensity: .5, valence: .4, work: { kind: 'tree', success: true, distance: 3 } })
  assert.equal(recallHistory(state, [], 100, 'tree', stm.all())[0]?.id, 'experience:4:tree')
  state.circadian.lastSleepDay = 4
  assert.deepEqual(recallHistory(state, [], 100, 'tree', stm.all()), [])
})
