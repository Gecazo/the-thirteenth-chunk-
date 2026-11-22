import assert from 'node:assert/strict'
import test from 'node:test'
import type { Bot } from 'mineflayer'
import { PNG } from 'pngjs'
import { Vec3 } from 'vec3'
import { parseConfig } from '../config'
import { Autonomy, advisedChoice, planPrompt } from '../brain/survival/autonomy'
import { treeTrunk } from '../behaviors/collectTree'
import { executeWork } from '../brain/survival/executeWork'
import { enumerateWork, maybeChooseSite } from '../brain/survival/opportunities'
import { insideWorkArea, protectedByProject, shelterCells, workshopCells } from '../brain/survival/site'
import { newMilestones } from '../brain/survival/progress'
import type { Work } from '../brain/survival/types'
import { renderWorldView } from '../brain/survival/vision'
import { defaultState, type SurvivalProject } from '../types/state'
import { clock, frame, log } from './fixtures'

const anchor = { x: 0, y: 64, z: 0 }
const origin = new Vec3(.5, 64, .5)

test('accepts only an index into the supplied job list', () => {
  assert.equal(advisedChoice({ choice: 0 }, 2), 0)
  assert.equal(advisedChoice({ choice: 1 }, 2), 1)
  for (const input of [null, [], {}, '0', { choice: -1 }, { choice: 2 }, { choice: 1.5 }, { choice: '0' }, { choice: NaN }, { choice: 0, pos: anchor }]) {
    assert.equal(advisedChoice(input, 2), undefined)
  }
  assert.equal(advisedChoice({ choice: 0 }, 0), undefined)
})

test('renders terrain in the facing direction and offers bounded, structured game facts', () => {
  const bot = { entity: { position: origin, yaw: 0, pitch: 0 }, time: { isDay: true },
    blockAt: (p: Vec3) => p.z === -4 ? { name: 'oak_log' } : null,
  } as unknown as Bot
  const view = () => PNG.sync.read(Buffer.from(renderWorldView(bot), 'base64'))
  const front = view()
  assert.equal(front.width, 256)
  assert.equal(front.height, 160)
  const center = (png: PNG) => [...png.data.subarray(4 * (80 * 256 + 128), 4 * (80 * 256 + 128) + 4)]
  assert.equal(center(front)[3], 255)
  bot.entity.yaw = Math.PI
  assert.deepEqual(center(view()), [118, 173, 224, 255])
  assert.notDeepEqual(center(front), center(view()))

  const image = renderWorldView(bot)
  const work: Work[] = [{ kind: 'walk', label: 'Explore east', pos: new Vec3(9, 64, 0) }, { kind: 'craft', label: 'Craft stick', name: 'stick' }]
  const prompt = planPrompt(defaultState('SoulBot', clock.now()), frame(), work, image)
  assert.equal(prompt.image, image)
  assert.match(prompt.user, /"jobs":\[\[0,"Explore east","walk",9\],\[1,"Craft stick","craft",null\]\]/)
  assert.deepEqual(prompt.format, { type: 'object', additionalProperties: false, required: ['choice'], properties: { choice: { type: 'integer', minimum: 0, maximum: 1 } } })
})

test('shelter has distinct wall and roof cells, open interior and a two-block entry', () => {
  const cells = shelterCells(anchor)
  assert.equal(new Set(cells.map(String)).size, cells.length)
  assert.equal(cells.length, 39)
  assert.equal(cells.filter(p => p.y === 64).length, 12)
  assert.equal(cells.filter(p => p.y === 65).length, 11)
  assert.equal(cells.filter(p => p.y === 66).length, 16)
  for (const y of [64, 65]) {
    assert.equal(cells.some(p => p.equals(new Vec3(2, y, 2))), false)
  }
  assert.ok(cells.every(p => insideWorkArea(anchor, p, 12)))
  assert.equal(insideWorkArea(anchor, { x: 12, y: 64, z: 1 }, 12), false)
  assert.equal(insideWorkArea(anchor, { x: 0, y: 75, z: 0 }, 12), false)
})

test('stone candidates exclude buried blocks before applying the search limit', () => {
  const buried = new Vec3(1, 62, 0), exposed = new Vec3(5, 64, 0)
  const blockAt = (p: Vec3) => ({ name: p.y < 64 || p.equals(exposed) ? 'stone' : 'air', position: p, canHarvest: () => true })
  const bot = { entity: { position: origin }, blockAt: (p: Vec3) => (p ? blockAt(p) : null), inventory: { items: () => [{ name: 'wooden_pickaxe', count: 1 }] },
    registry: { itemsByName: {}, blocksByName: { stone: { id: 1 } } },
    findBlocks: (options: { useExtraInfo?: (block: unknown) => boolean }) => {
      const list = [buried, exposed]
      return options.useExtraInfo ? list.filter(p => options.useExtraInfo!(blockAt(p))) : list
    },
  } as unknown as Bot
  const work = enumerateWork(bot, { anchor }, 28, null, new Map(), () => false)
  assert.deepEqual(work[0], { kind: 'mine', label: 'Gather stone', pos: exposed, name: 'stone' })
})

function craftingFixture() {
  let count = 0
  const crafted: number[] = []
  const bot = {
    game: { dimension: 'overworld', gameMode: 'survival' }, entity: { position: origin }, blockAt: () => null,
    inventory: { items: () => [{ name: 'oak_log', count: 1 }], count: () => count },
    registry: { itemsByName: { oak_planks: { id: 1 }, crafting_table: { id: 2 } }, blocksByName: {} },
    recipesFor: (id: number) => [{ id, requiresTable: false }],
    craft: async ({ id }: { id: number }) => { crafted.push(id); count++ },
  } as unknown as Bot
  return { bot, crafted }
}

const config = parseConfig({ AUTONOMY_ENABLED: 'true', AUTONOMY_VISION: 'false' })

test('uses a valid model choice, and falls back deterministically on rejection or failure', async () => {
  const state = defaultState('SoulBot', clock.now()), signal = new AbortController().signal
  for (const [answer, expected] of [[{ choice: 1 }, 2], [{ choice: 999 }, 1], [new Error('Ollama offline'), 1]] as const) {
    const { bot, crafted } = craftingFixture()
    const autonomy = new Autonomy(bot, { ...config, AUTONOMY_REQUIRE_AI: false }, log, { async propose() { if (answer instanceof Error) throw answer; return answer } })
    const updates: unknown[] = []
    await autonomy.work(state, frame(), p => updates.push(p), signal)
    assert.deepEqual(crafted, [expected])
    assert.deepEqual(updates, [{ anchor }])
  }
})

test('strict AI mode asks for each job and will not silently execute a rejected plan', async () => {
  const { bot, crafted } = craftingFixture()
  let calls = 0
  const autonomy = new Autonomy(bot, config, log, { async propose() { return { choice: ++calls === 1 ? 1 : 999 } } })
  const state = defaultState('SoulBot', clock.now()), signal = new AbortController().signal
  await autonomy.work(state, frame(), () => {}, signal)
  await autonomy.work(state, frame(), () => {}, signal)
  assert.equal(calls, 2)
  assert.deepEqual(crafted, [2])
})

test('cancels an in-flight model decision before it can start a job', async () => {
  const { bot, crafted } = craftingFixture()
  const abort = new AbortController()
  const autonomy = new Autonomy(bot, config, log, { propose(_prompt, signal) {
    abort.abort(new Error('operator stop'))
    assert.equal(signal.aborted, true)
    return Promise.resolve({ choice: 0 })
  } })
  await assert.rejects(autonomy.work(defaultState('SoulBot', clock.now()), frame(), () => {}, abort.signal), /operator stop/)
  assert.deepEqual(crafted, [])
})

test('validates placement against a clear ray to the correct support face', async () => {
  const pos = new Vec3(2, 64, 0), support = pos.offset(0, -1, 0)
  let placed = false
  const bot = {
    entity: { position: origin, eyeHeight: 1.62 }, entities: {}, currentWindow: null, heldItem: { name: 'crafting_table' },
    inventory: { items: () => [{ name: 'crafting_table' }] },
    blockAt: (p: Vec3) => p.equals(support) ? { name: 'grass_block', position: support, boundingBox: 'block' }
      : { name: placed && p.equals(pos) ? 'crafting_table' : 'air', position: p },
    world: { getBlock: () => ({ shapes: [[0, 0, 0, 1, 1, 1]] }), raycast: (_p: Vec3, unit: Vec3, range: number) => {
      assert.ok(Math.abs(unit.norm() - 1) < 1e-9)
      // This support is more than 1 block away; normalizing must not shorten the ray.
      assert.ok(range > 2.5)
      return { position: support, face: 1 }
    } },
    equip: async () => {}, lookAt: async () => {}, placeBlock: async () => { placed = true },
  } as unknown as Bot
  const job: Work = { kind: 'place', purpose: 'workshop', name: 'crafting_table', label: 'Place workbench', pos }
  const signal = new AbortController().signal
  await executeWork(bot, job, { anchor, workshop: { x: pos.x, y: pos.y, z: pos.z } }, 28, signal)
  assert.equal(placed, true)
  await assert.rejects(executeWork(bot, job, { anchor, workshop: { x: pos.x, y: pos.y, z: pos.z } }, 28, signal), /occupied cell/)
})

test('tree jobs recognize a soil-rooted trunk with foliage, not a pillar or project blocks', () => {
  const base = new Vec3(3, 64, 2)
  const trunk = [0, 1, 2, 3].map(y => base.offset(0, y, 0))
  const blocks = new Map(trunk.map(p => [String(p), 'spruce_log']))
  const canopy = String(base.offset(1, 3, 0))
  const ground = String(base.offset(0, -1, 0))
  const bot = { blockAt: (p: Vec3) => ({ name: blocks.get(String(p)) ?? 'air' }) } as unknown as Bot
  blocks.set(ground, 'grass_block')
  assert.deepEqual(treeTrunk(bot, base, { anchor }, 12), [])
  blocks.set(canopy, 'spruce_leaves')
  assert.deepEqual(treeTrunk(bot, base, { anchor }, 12), trunk)
  assert.deepEqual(treeTrunk(bot, base, { anchor, shelter: anchor }, 12), [])
  assert.deepEqual(treeTrunk(bot, base, { anchor: { ...anchor, y: 55 } }, 12), [])
  blocks.set(ground, 'oak_planks')
  assert.deepEqual(treeTrunk(bot, base, { anchor }, 12), [])
})

test('stopping a tree job cancels the active dig without touching the rest of the trunk', async () => {
  const base = new Vec3(2, 64, 0)
  const abort = new AbortController()
  const dug: Vec3[] = []
  let stopped = 0
  const bot = {
    entity: { position: origin }, heldItem: null, canDigBlock: () => true,
    blockAt: (p: Vec3) => ({ position: p, canHarvest: () => true,
      name: p.equals(base.offset(0, -1, 0)) ? 'grass_block'
        : p.x === base.x && p.z === base.z && p.y >= 64 && p.y <= 67 ? 'oak_log'
        : p.equals(base.offset(1, 3, 0)) ? 'oak_leaves' : 'air',
    }),
    world: { raycast: () => ({ position: base }) }, pathfinder: { bestHarvestTool: () => null },
    lookAt: async () => {}, stopDigging: () => { stopped++ },
    dig: async ({ position }: { position: Vec3 }) => { dug.push(position); abort.abort(new Error('operator stop')) },
  } as unknown as Bot
  await assert.rejects(executeWork(bot, { kind: 'tree', label: 'Tree', pos: base }, { anchor }, 28, abort.signal), /operator stop/)
  assert.deepEqual(dug, [base])
  assert.equal(stopped, 1)
})

test('tree jobs break the full trunk and collect nearby drops', async () => {
  const base = new Vec3(2, 64, 0)
  const trunk = [0, 1, 2, 3].map(y => base.offset(0, y, 0))
  const broken = new Set<string>()
  let collected = false
  const bot = {
    entity: { position: origin, height: 1.8, eyeHeight: 1.62 }, heldItem: null, currentWindow: null,
    entities: {
      99: {
        id: 99, isValid: true, name: 'item', position: base.offset(2.2, 0, 0.6),
        getDroppedItem: () => ({ name: 'oak_log' }),
      },
    },
    inventory: { items: () => [] },
    canDigBlock: () => true,
    blockAt: (p: Vec3) => ({
      position: p,
      boundingBox: p.equals(base.offset(0, -1, 0)) || p.equals(base.offset(1, -1, 0)) || p.equals(base.offset(-1, -1, 0)) || p.equals(base.offset(0, -1, 1)) || p.equals(base.offset(0, -1, -1)) ? 'block' : 'empty',
      canHarvest: () => true,
      name: p.equals(base.offset(0, -1, 0)) ? 'grass_block'
        : p.equals(base.offset(1, 3, 0)) ? 'oak_leaves'
        : trunk.some(t => t.equals(p)) && !broken.has(String(p)) ? 'oak_log'
        : 'air',
    }),
    world: {
      raycast: () => ({ position: trunk.find(t => !broken.has(String(t))) ?? base, face: 1 }),
    },
    pathfinder: {
      bestHarvestTool: () => null,
      goto: async (goal: { x: number; y: number; z: number; range?: number }) => {
        if (Math.abs(goal.x - (base.x + 2)) <= 1 && Math.abs(goal.z - base.z) <= 1) {
          collected = true
          bot.entity.position = new Vec3(goal.x + 0.5, goal.y, goal.z + 0.5)
        }
      },
      setGoal: () => {},
    },
    lookAt: async () => {},
    stopDigging: () => {},
    dig: async ({ position }: { position: Vec3 }) => {
      broken.add(String(position))
    },
    equip: async () => {},
  } as unknown as Bot
  await executeWork(bot, { kind: 'tree', label: 'Tree', pos: base }, { anchor }, 28, new AbortController().signal)
  assert.equal(broken.size, 4)
  assert.equal(collected, true)
})

test('expands only after a complete home, protects the new plot, and records milestones only once', () => {
  const project: SurvivalProject = { anchor, shelter: { x: 4, y: 64, z: 0 } }
  const house = shelterCells(project.shelter!)
  const placed = new Set(house.slice(1).map(String))
  const bot = { inventory: { items: () => [{ name: 'iron_pickaxe' }] }, blockAt: (p: Vec3) => ({
    name: p.y === 63 ? 'grass_block' : placed.has(String(p)) ? 'oak_planks' : 'air',
  }) } as unknown as Bot
  assert.equal(maybeChooseSite(bot, project, 28), project)
  assert.deepEqual(newMilestones(bot, project), ['stone_tools', 'iron_tools'])
  placed.add(String(house[0]))
  const expanded = maybeChooseSite(bot, project, 28)
  assert.ok(expanded.workshop)
  const workshop = workshopCells(expanded.workshop)
  assert.equal(new Set(workshop.map(String)).size, 18)
  assert.ok(workshop[0]?.equals(new Vec3(expanded.workshop.x, expanded.workshop.y, expanded.workshop.z - 1)))
  assert.ok(workshop.every(p => insideWorkArea(anchor, p, 28) && protectedByProject(expanded, p) && !house.some(c => c.equals(p))))
  assert.ok(protectedByProject(expanded, workshop[0]!.offset(0, -1, 0)))
  assert.deepEqual(newMilestones(bot, expanded), ['stone_tools', 'home', 'iron_tools'])
  for (const cell of workshop) placed.add(String(cell))
  assert.deepEqual(newMilestones(bot, { ...expanded, milestones: ['stone_tools', 'home', 'iron_tools'] }), ['workshop'])
  assert.deepEqual(newMilestones(bot, { ...expanded, milestones: ['stone_tools', 'home', 'iron_tools', 'workshop'] }), [])
})

test('does not offer iron ore without a tool that can collect it', () => {
  const ore = new Vec3(5, 64, 0)
  const blockAt = (p: Vec3) => ({ name: p.equals(ore) ? 'iron_ore' : 'air', position: p, canHarvest: (id: number) => id === 2 })
  let type = 1
  const bot = { entity: { position: origin }, blockAt, inventory: { items: () => [{ name: 'stone_pickaxe', count: 1, type }] },
    registry: { itemsByName: {}, blocksByName: { iron_ore: { id: 8 } } },
    findBlocks: (options: { useExtraInfo: (block: unknown) => boolean }) => options.useExtraInfo(blockAt(ore)) ? [ore] : [],
  } as unknown as Bot
  const project: SurvivalProject = { anchor, milestones: ['home'] }
  const jobs = () => enumerateWork(bot, project, 28, null, new Map(), () => false)
  assert.equal(jobs().some(w => w.kind === 'mine'), false)
  type = 2
  assert.deepEqual(jobs()[0], { kind: 'mine', label: 'Gather iron_ore', name: 'iron_ore', pos: ore })
})

test('starts a small furnace batch, closes the window, then collects output without reloading fuel', async () => {
  const pos = new Vec3(2, 64, 0), edits: unknown[] = []
  const source = { name: 'raw_iron', type: 1 }, coal = { name: 'coal', type: 2 }
  let finished = false, opening = 0
  const window = {
    id: 3, inputItem: () => null, outputItem: () => finished ? { name: 'iron_ingot' } : null, fuelItem: () => null,
    putFuel: async (id: number, _metadata: null, count: number) => { edits.push(['fuel', id, count]) },
    putInput: async (id: number, _metadata: null, count: number) => { edits.push(['input', id, count]) },
    takeOutput: async () => { edits.push('output') }, close: async () => { edits.push('close'); bot.currentWindow = null },
  }
  const bot = { entity: { position: origin }, currentWindow: null, world: { raycast: () => ({ position: pos }) },
    blockAt: () => ({ name: 'furnace', position: pos }), inventory: { items: () => [source, coal], count: (id: number) => id === 1 ? 7 : id === 2 ? 1 : 0 },
    registry: { itemsByName: { iron_ingot: { id: 3 } } }, openFurnace: async () => { opening++; bot.currentWindow = window; return window },
  } as { currentWindow: typeof window | null }
  const project = { anchor, furnace: { x: 2, y: 64, z: 0 } }
  const signal = new AbortController().signal, job: Work = { kind: 'smelt', label: 'Smelt iron', pos }
  const run = (p: SurvivalProject) => executeWork(bot as unknown as Bot, job, p, 28, signal, active => edits.push(active))
  await assert.rejects(run({ anchor }), /own furnace/)
  assert.equal(opening, 0)
  await run(project)
  assert.deepEqual(edits, [true, ['fuel', 2, 1], ['input', 1, 3], 'close'])
  finished = true
  edits.length = 0
  await run({ ...project, smelting: true })
  assert.deepEqual(edits, ['output', false, 'close'])
})
