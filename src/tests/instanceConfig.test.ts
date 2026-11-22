import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig, parseConfig } from '../config'

test('instances isolate defaults from the standalone profile and support per-bot configuration', () => {
  const dir = mkdtempSync(join(tmpdir(), 'soulbot-config-'))
  try {
    writeFileSync(join(dir, '.env'), 'MC_HOST=test-server\nMC_PORT=25570\nMC_USERNAME=OldBot\nSTATE_PATH=./old.md\nMC_AUTH_CACHE=./old-auth\nMC_ADMINS=Admin\n')
    writeFileSync(join(dir, '.env.cedar'), 'MC_USERNAME=CedarBot\nMC_PORT=25571\nMC_ADMINS=Owner\n')
    const cedar = loadConfig(['--instance', 'cedar'], { SOULBOT_INSTANCE: 'other', MC_PORT: '25572' }, dir)
    const birch = loadConfig([], { SOULBOT_INSTANCE: 'birch' }, dir)
    assert.equal(cedar.MC_HOST, 'test-server')
    assert.equal(cedar.MC_PORT, 25572)
    assert.equal(cedar.MC_USERNAME, 'CedarBot')
    assert.deepEqual([...cedar.MC_ADMINS], ['owner'])
    assert.equal(cedar.STATE_PATH, join('data', 'instances', 'cedar', 'soul.md'))
    assert.equal(cedar.MC_AUTH_CACHE, join('data', 'instances', 'cedar', 'auth'))
    assert.equal(birch.MC_USERNAME, 'birch')
    assert.equal(birch.MC_PORT, 25570)
    assert.equal(birch.STATE_PATH, join('data', 'instances', 'birch', 'soul.md'))
    assert.equal(loadConfig([], {}, dir).STATE_PATH, './old.md')
    assert.throws(() => loadConfig(['--instance', '../cedar'], {}, dir), /instance name/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('an online instance requires its own configured account', () => {
  assert.throws(() => parseConfig({ SOULBOT_INSTANCE: 'cedar', MC_AUTH: 'microsoft' }), /Microsoft account/)
  assert.equal(parseConfig({ SOULBOT_INSTANCE: 'cedar', MC_AUTH: 'microsoft', MC_USERNAME: 'cedar@example.com' }).MC_USERNAME, 'cedar@example.com')
})
