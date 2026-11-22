import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseConfig } from '../config'
import { emptySoul, parseSoulDocument } from '../storage/soulDocument'
import { createSoulFile, openSoulFile } from '../storage/soulFile'
import { importLegacy } from '../storage/importLegacy'
import { defaultState } from '../types/state'
import { clock } from './fixtures'

test('Markdown is the default and legacy extensions are rejected for normal operation', () => {
  assert.equal(parseConfig().STATE_PATH, './soul.md')
  assert.equal(parseConfig({ STATE_PATH: './data/second-bot.md' }).STATE_PATH, './data/second-bot.md')
  assert.throws(() => parseConfig({ STATE_PATH: './data/soulbot.sqlite' }), /Use a Markdown path/)
})

test('renders readable Markdown safely and restores the full state from its checkpoint', () => {
  const dir = mkdtempSync(join(tmpdir(), 'soulbot-markdown-')), path = join(dir, 'soul.md')
  try {
    const state = defaultState('SoulBot', clock.now())
    state.goals.userGoal = '[note](https://example.com)\n```\n<!-- soulbot:checkpoint:v1 -->'
    state.project = { anchor: { x: 0, y: 64, z: 0 }, table: { x: 2, y: 64, z: 0 }, shelter: { x: 5, y: 64, z: 2 },
      workshop: { x: 12, y: 64, z: 2 }, furnace: { x: 2, y: 64, z: 2 }, smelting: true, milestones: ['stone_tools', 'home'] }
    const storage = openSoulFile(path)
    storage.checkpoint({ state, events: [] })
    storage.close()
    const markdown = readFileSync(path, 'utf8')
    assert.match(markdown, /^# SoulBot\n/)
    assert.match(markdown, /## Personality and values/)
    assert.match(markdown, /\*\*Operator note:\*\* &#91;note&#93;/)
    assert.match(markdown, /## Survival progress\n\n- \[x\] Stone tools\n- \[x\] Starter home\n- \[ \] Iron tools/)
    assert.deepEqual(parseSoulDocument(markdown.replaceAll('\n', '\r\n')).state, state)
    const reopened = openSoulFile(path)
    try { assert.deepEqual(reopened.load().state, state) } finally { reopened.close() }
    assert.deepEqual(readdirSync(dir), ['soul.md'])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('preserves malformed saves, external edits and existing import destinations', () => {
  const dir = mkdtempSync(join(tmpdir(), 'soulbot-protect-')), path = join(dir, 'soul.md')
  try {
    const state = defaultState('SoulBot', clock.now()), storage = openSoulFile(path)
    storage.checkpoint({ state, events: [] })
    const edit = '# Notes\nDo not overwrite\n'
    writeFileSync(path, edit)
    assert.throws(() => storage.checkpoint({ state, events: [] }), /changed outside the bot/)
    storage.close()
    assert.throws(() => openSoulFile(path), /original file was not changed/)
    assert.throws(() => createSoulFile(path, emptySoul()), { code: 'EEXIST' })
    assert.equal(readFileSync(path, 'utf8'), edit)
    assert.deepEqual(readdirSync(dir), ['soul.md'])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('imports a legacy JSON file without touching the original', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'soulbot-import-')), path = join(dir, 'soul.md'), source = join(dir, 'legacy.json')
  try {
    const state = defaultState('SoulBot', clock.now())
    const raw = JSON.stringify({ ...emptySoul(), state })
    writeFileSync(source, raw)
    await importLegacy(source, path)
    const storage = openSoulFile(path)
    try { assert.deepEqual(storage.load().state, state) } finally { storage.close() }
    await assert.rejects(importLegacy(source, path), { code: 'EEXIST' })
    assert.equal(readFileSync(source, 'utf8'), raw)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('an open save excludes other writers even via an aliased directory, and close makes it reusable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'soulbot-lock-')), real = join(dir, 'real'), alias = join(dir, 'alias')
  try {
    mkdirSync(real)
    symlinkSync(real, alias, 'dir')
    const path = join(real, 'soul.md'), aliasPath = join(alias, 'soul.md')
    const first = openSoulFile(path)
    const state = defaultState('First', clock.now())
    try {
      assert.throws(() => openSoulFile(aliasPath), /already locked/)
      assert.throws(() => createSoulFile(path, { ...emptySoul(), state }), /already locked/)
      first.checkpoint({ state, events: [] })
      const second = openSoulFile(join(real, 'other.md'))
      try { second.checkpoint({ state: defaultState('Second', clock.now()), events: [] }) } finally { second.close() }
    } finally { first.close() }
    const reopened = openSoulFile(aliasPath)
    try {
      first.close()
      assert.throws(() => openSoulFile(path), /already locked/)
      assert.throws(() => first.checkpoint({ state, events: [] }), /closed/)
      assert.deepEqual(reopened.load().state, state)
    } finally { reopened.close() }
    assert.deepEqual(readdirSync(real).sort(), ['other.md', 'soul.md'])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
