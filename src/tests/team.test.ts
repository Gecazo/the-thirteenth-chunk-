import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { TeamBoard, teamJobKey } from '../brain/survival/team'
import { Vec3 } from 'vec3'

test('independent bot connections share updates and reserve different blocks atomically', async () => {
  const { DatabaseSync } = await import('node:sqlite')
  const dir = mkdtempSync(join(tmpdir(), 'soul-team-')), path = join(dir, 'team.sqlite')
  const home = { x: 10, y: 64, z: 10 }
  const cedar = new TeamBoard(new DatabaseSync(path), 'crew', 'cedar', home)
  const birch = new TeamBoard(new DatabaseSync(path), 'crew', 'birch', home)
  const first = teamJobKey({ kind: 'place', pos: new Vec3(10, 64, 10), purpose: 'shelter', name: 'oak_planks', label: 'Build wall' })!
  const second = teamJobKey({ kind: 'place', pos: new Vec3(11, 64, 10), purpose: 'shelter', name: 'oak_planks', label: 'Build wall' })!
  try {
    cedar.report('Build wall', 100)
    assert.deepEqual(birch.peers(101), [{ name: 'cedar', activity: 'Build wall' }])
    assert.deepEqual(birch.peers(60_101), [])
    assert.ok(cedar.claim([first], 5000, 100))
    assert.ok(!birch.claim([second, first], 5000, 101))
    assert.ok(birch.claim([second], 5000, 102)) // Failed multi-block claim left no partial reservation.
    assert.deepEqual([...birch.unavailable(103)], [first])
    birch.release(first)
    assert.ok(!birch.claim([first], 5000, 104))
    assert.ok(birch.claim([first], 5000, 5100))
  } finally { cedar.close(); birch.close(); rmSync(dir, { recursive: true, force: true }) }
})
