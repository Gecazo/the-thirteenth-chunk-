import type { Bot } from 'mineflayer'
import { goals, type Move } from 'mineflayer-pathfinder'
import { Vec3 } from 'vec3'
import { errorMessage, untilAbort } from '../../infra/errors'
import { delay } from '../../infra/clock'
import type { SurvivalProject } from '../../types/state'
import { insideWorkArea, protectedByProject, cellHasEntity, shelterCells, standable, workshopCells, blueprintCells, roleAccepts } from './site'
import { faces, isPick, mineable, placementSupports } from './opportunities'
import { buildMaterials, center, eye, ironOres, isAir, logs, smeltingFuels, soilBlocks, type LocalBlock, type Mining, type Work } from './types'
import { treeTrunk } from '../../behaviors/collectTree'
import { dangerousBlocks } from '../../bot/perception'
import { safeFoods } from '../../behaviors/eatIfHungry'
import type { Logger } from '../../infra/logger'

const reach = 4.2

const crafts = new Set([...buildMaterials, 'stick', 'crafting_table', 'wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'torch', 'bread', 'furnace', 'chest', 'oak_stairs', 'cobblestone_stairs', 'glass', 'glass_pane', 'oak_door', 'spruce_door', 'birch_door'])

// The sync implementation returns a Block plus its hit face, rather than the declared iterator result.
function rayTo(bot: Bot, from: Vec3, target: Vec3) {
  const offset = target.minus(from), distance = offset.norm()
  if (distance > reach || distance < .001) return null
  return bot.world.raycast(from, offset.unit(), distance + .05) as { position?: Vec3; face: number } | null
}

const seesCenter = (bot: Bot, from: Vec3, pos: Vec3) => Boolean(rayTo(bot, from, center(pos))?.position?.equals(pos))
const canReach = (bot: Bot, block: LocalBlock) => seesCenter(bot, eye(bot), block.position)

// mineflayer's bot.dig() sweep-checks the block's whole collision box against the view ray,
// so an exact hit on the block center is not required. Accept when the ray stops at the
// target itself or in a directly adjacent voxel (hole rims occlude the exact center line of
// a stone sitting in a 1-deep pit, yet the dig still lands). Measure exactly like
// bot.canDigBlock does (eye at +1.65, limit 5.1) — our own stricter caps produced stones
// that mineflayer could dig but we rejected.
function canDigFromHere(bot: Bot, block: LocalBlock): boolean {
  const from = bot.entity.position.offset(0, 1.65, 0), target = center(block.position)
  const offset = target.minus(from), distance = offset.norm()
  if (distance > 5.05) return false
  const hit = bot.world.raycast(from, offset.unit(), distance + .05) as { position?: Vec3 } | null
  if (!hit?.position) return false
  const delta = hit.position.minus(block.position)
  return Math.abs(delta.x) <= 1 && Math.abs(delta.y) <= 1 && Math.abs(delta.z) <= 1
}
const pickupOffsets = [new Vec3(0, 0, 0), new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1), new Vec3(1, 0, 1), new Vec3(-1, 0, 1), new Vec3(1, 0, -1), new Vec3(-1, 0, -1)]

function expectedDrops(name: string): Set<string> {
  const result = new Set([name])
  if (name === 'stone') result.add('cobblestone')
  if (name === 'grass_block') result.add('dirt')
  if (name.endsWith('coal_ore')) result.add('coal')
  if (ironOres.has(name)) result.add('raw_iron')
  return result
}

function pickupSpot(bot: Bot, project: SurvivalProject, radius: number, itemPos: Vec3): Vec3 | undefined {
  return pickupOffsets.map(offset => itemPos.floored().plus(offset))
    .filter(pos => insideWorkArea(project.anchor, pos, radius) && standable(bot, pos) && center(pos).distanceTo(itemPos) <= 2.3)
    .sort((a, b) => center(a).distanceTo(bot.entity.position) - center(b).distanceTo(bot.entity.position))[0]
}

async function collectExpectedDrops(bot: Bot, project: SurvivalProject, radius: number, origin: Vec3, dropNames: Set<string>, signal: AbortSignal) {
  const nearbyDrops = () => Object.values(bot.entities).filter(e => e.isValid && e.name === 'item' && e.position.distanceTo(center(origin)) <= 6)
    .flatMap(entity => {
      const item = entity.getDroppedItem()?.name
      return item && dropNames.has(item) ? [{ entity, item }] : []
    }).sort((a, b) => a.entity.position.distanceTo(bot.entity.position) - b.entity.position.distanceTo(bot.entity.position))
  for (let pass = 0; pass < 5; pass++) {
    signal.throwIfAborted()
    const drops = nearbyDrops()
    if (!drops.length) return
    let moved = false
    for (const { entity } of drops.slice(0, 8)) {
      signal.throwIfAborted()
      const spot = pickupSpot(bot, project, radius, entity.position)
      if (!spot) continue
      moved = await gotoNear(bot, spot, 1, signal) || moved
      await delay(moved ? 110 : 60, signal)
    }
    const remaining = nearbyDrops()
    if (!remaining.length) return
    if (!moved && remaining.length >= drops.length) return
    await delay(moved ? 130 : 80, signal)
  }
}

class GoalForInteraction extends goals.Goal {
  constructor(private readonly bot: Bot, private readonly target: Vec3, private readonly height: number, private readonly accepts: (feet: Vec3, eye: Vec3) => boolean) { super() }
  heuristic(node: Move) { return Math.max(0, Math.hypot(node.x - this.target.x, node.y - this.target.y, node.z - this.target.z) - reach) }
  isEnd(node: Move) {
    const feet = new Vec3(node.x + .5, node.y, node.z + .5)
    // Pathfinder may also test the voxel above the actual feet; never accept it without footing.
    return standable(this.bot, feet.floored()) && this.accepts(feet, feet.offset(0, this.height, 0))
  }
}

/** The stone the planner offered is out of arm's reach from every spot the pathfinder can
 *  reach right now. Failing fast (before any walking) keeps the planner from fixating on it. */
function unreachableForMining(bot: Bot, block: LocalBlock, project: SurvivalProject, radius: number): boolean {
  const feet = bot.entity.position.floored()
  if (canDigFromHere(bot, block)) return false
  for (const dx of [-1, 0, 1]) for (const dz of [-1, 0, 1]) for (const dy of [-1, 0, 1]) {
    const cell = block.position.offset(dx, dy, dz)
    if (!standable(bot, cell) || !insideWorkArea(project.anchor, cell, radius)) continue
    const eye = cell.offset(.5, 1.62, .5)
    const target = center(block.position)
    const distance = target.minus(eye).norm()
    if (distance > 5) continue
    const hit = bot.world.raycast(eye, target.minus(eye).unit(), distance + .05) as { position?: Vec3 } | null
    if (!hit?.position) continue
    const delta = hit.position.minus(block.position)
    if (Math.abs(delta.x) <= 1 && Math.abs(delta.y) <= 1 && Math.abs(delta.z) <= 1) return false
  }
  // Never reject the bot's own digging level or visible surface work below; only reject
  // when every neighbor cell is standable-checked above and none can dig.
  void feet; void project
  return true
}

async function goto(bot: Bot, goal: goals.Goal, signal: AbortSignal) {
  signal.throwIfAborted()
  if (!bot.pathfinder) throw new Error('Pathfinder is unavailable')
  // Dense forest and long detours need more search budget than the client default.
  const previous = bot.pathfinder.thinkTimeout
  bot.pathfinder.thinkTimeout = Math.max(previous ?? 0, 9000)
  try { await untilAbort(bot.pathfinder.goto(goal), signal) } finally {
    bot.pathfinder.setGoal(null)
    if (previous !== undefined) bot.pathfinder.thinkTimeout = previous
  }
  signal.throwIfAborted()
}

async function gotoNear(bot: Bot, pos: Vec3, radius: number, signal: AbortSignal): Promise<boolean> {
  const at = bot.entity.position
  if (Math.max(Math.abs(at.x - (pos.x + .5)), Math.abs(at.z - (pos.z + .5))) <= radius + .3 && Math.abs(at.y - pos.y) <= 1.5) return false
  await goto(bot, new goals.GoalNear(pos.x, pos.y, pos.z, radius), signal)
  return true
}

async function approach(bot: Bot, pos: Vec3, signal: AbortSignal) {
  const from = eye(bot)
  if (seesCenter(bot, from, pos)) return
  try {
    const goal = new GoalForInteraction(bot, pos, from.y - bot.entity.position.y, (_feet, eyes) => seesCenter(bot, eyes, pos))
    await goto(bot, goal, signal)
  } catch (error) {
    // In dense forest the exact line-of-sight goal can exhaust the search budget or be
    // unreachable from every standable cell (hole rims). Getting within arm's reach is
    // enough for the dig sweep-check to succeed.
    const message = errorMessage(error)
    if (message.includes('Took to long') || message.includes('No path')) {
      await goto(bot, new goals.GoalNear(pos.x, pos.y, pos.z, 2), signal)
      return
    }
    throw error
  }
}

async function harvest(bot: Bot, work: Mining, project: SurvivalProject, radius: number, signal: AbortSignal, rooted = false) {
  const check = () => {
    const b = bot.blockAt(work.pos, false)
    const permitted = rooted ? logs.has(work.name) && insideWorkArea(project.anchor, work.pos, radius) && !protectedByProject(project, work.pos) &&
      !faces.some(face => dangerousBlocks.has(bot.blockAt(work.pos.plus(face), false)?.name ?? ''))
      : b && mineable(bot, b, project, radius)
    if (!b || b.name !== work.name || !permitted) throw new Error('Resource changed or is no longer eligible')
    return b
  }
  check()
  if (!unreachableForMining(bot, bot.blockAt(work.pos, false)!, project, radius)) {
    if (!rooted) await approach(bot, work.pos, signal)
  }
  const ready = check()
  let tool = bot.pathfinder.bestHarvestTool(ready)
  if (!logs.has(work.name) && !soilBlocks.has(work.name)) {
    if (!tool || !isPick(tool.name) || !ready.canHarvest(tool.type)) tool = bot.inventory.items().find(i => isPick(i.name) && ready.canHarvest(i.type)) ?? null
    if (!tool) throw new Error('No suitable pickaxe')
  } else {
    // Any wood type works: prefer an axe for speed, but a bare hand is always acceptable.
    tool ??= bot.inventory.items().find(i => i.name.endsWith('_axe') && ready.canHarvest(i.type)) ?? null
  }
  if (tool) await untilAbort(bot.equip(tool, 'hand'), signal)
  // Re-approach after look-at: the ray to a high log can be flaky from one angle.
  const diggable = async () => {
    const block = check()
    if (!canDigFromHere(bot, block) || !bot.canDigBlock(block)) {
      // Second chance: step into a cell adjacent to the block's own X/Z columns (stone
      // under a hole rim is only diggable from inside the pit itself).
      try { await approach(bot, block.position, signal) } catch {
        await goto(bot, new goals.GoalNear(block.position.x, block.position.y, block.position.z, 1), signal)
      }
    }
    const target = check()
    return canDigFromHere(bot, target) && bot.canDigBlock(target) ? target : null
  }
  let block = await diggable()
  if (!block) throw new Error('Resource is not harvestable from here')
  const stop = () => bot.stopDigging()
  signal.throwIfAborted()
  await untilAbort(bot.lookAt(center(block.position), true), signal)
  block = await diggable()
  if (!block) throw new Error('Resource no longer in sight')
  signal.throwIfAborted()
  signal.addEventListener('abort', stop, { once: true })
  try { await untilAbort(bot.dig(block, 'ignore'), signal) } finally { signal.removeEventListener('abort', stop) }
  if (bot.blockAt(work.pos, false)?.name === work.name) throw new Error('Block did not break')
  // Pick up the drop only at a safe standing position; never tunnel or step into a hole for it.
  if (standable(bot, work.pos) && bot.entity.position.distanceTo(center(work.pos)) > .9) {
    await gotoNear(bot, work.pos, 1, signal)
  }
  // Drops from overhead may settle nearby: collect all matching items in this local area.
  await delay(240, signal)
  await collectExpectedDrops(bot, project, radius, work.pos, expectedDrops(work.name), signal)
}

async function smeltIron(bot: Bot, pos: Vec3, project: SurvivalProject, signal: AbortSignal, pending: (active: boolean) => void) {
  const currentWindow = () => bot.currentWindow
  if (currentWindow() || !project.furnace || pos.x !== project.furnace.x || pos.y !== project.furnace.y || pos.z !== project.furnace.z) throw new Error('Only use the bot’s own furnace')
  await approach(bot, pos, signal)
  const block = bot.blockAt(pos, false)
  if (block?.name !== 'furnace' || !canReach(bot, block)) throw new Error('Furnace is missing or not reachable')
  signal.throwIfAborted()
  const opening = bot.openFurnace(block)
  void opening.then(window => { if (signal.aborted && currentWindow()?.id === window.id) return window.close() }).catch(() => {})
  const furnace = await untilAbort(opening, signal)
  try {
    const input = furnace.inputItem(), output = furnace.outputItem(), fuel = furnace.fuelItem()
    if ((input && input.name !== 'raw_iron') || (output && output.name !== 'iron_ingot') || (fuel && !smeltingFuels.includes(fuel.name))) {
      throw new Error('Furnace already contains unrelated items')
    }
    signal.throwIfAborted()
    if (output) {
      await untilAbort(furnace.takeOutput(), signal)
      pending(Boolean(furnace.inputItem()))
      return
    }
    if (input && furnace.fuel > 0) { pending(true); return }
    const items = bot.inventory.items()
    const source = items.find(i => i.name === 'raw_iron')
    if (!input && !source) { pending(false); return }
    const fuelSource = fuel ? items.find(i => i.name === fuel.name) : smeltingFuels.map(name => items.find(i => i.name === name)).find(Boolean)
    const perItem = (fuel?.name ?? fuelSource?.name)?.endsWith('_planks') ? 1.5 : 8
    const totalFuel = (fuel?.count ?? 0) + (fuelSource ? bot.inventory.count(fuelSource.type, null) : 0)
    const ingot = bot.registry.itemsByName.iron_ingot
    const count = input?.count ?? Math.min(bot.inventory.count(source!.type, null), Math.max(1, 3 - (ingot ? bot.inventory.count(ingot.id, null) : 0)), Math.floor(totalFuel * perItem))
    if (count < 1 || totalFuel < Math.ceil(count / perItem)) { pending(Boolean(input)); throw new Error('No suitable furnace fuel') }
    pending(true)
    signal.throwIfAborted()
    const neededFuel = Math.ceil(count / perItem) - (fuel?.count ?? 0)
    if (neededFuel > 0 && fuelSource) await untilAbort(furnace.putFuel(fuelSource.type, null, neededFuel), signal)
    signal.throwIfAborted()
    if (!input && source) await untilAbort(furnace.putInput(source.type, null, count), signal)
  } finally {
    if (currentWindow()?.id === furnace.id) await furnace.close()
  }
}

export async function executeWork(bot: Bot, work: Work, project: SurvivalProject, radius: number, signal: AbortSignal, pending: (active: boolean) => void = () => {}, log?: Logger) {
  signal.throwIfAborted()
  if (!insideWorkArea(project.anchor, bot.entity.position, radius + 1)) throw new Error('Bot is outside its work area')
  if (work.kind !== 'craft' && !insideWorkArea(project.anchor, work.pos, radius)) throw new Error('Target is outside work area')
  if (work.kind === 'walk') {
    if (!standable(bot, work.pos)) throw new Error('Exploration target is no longer walkable')
    await gotoNear(bot, work.pos, 1, signal)
    if (bot.entity.position.distanceTo(center(work.pos)) > 2) throw new Error('Could not reach exploration target')
    return
  }
  if (work.kind === 'tree') {
    const trunk = treeTrunk(bot, work.pos, project, radius)
    if (!trunk.length) throw new Error('Not a rooted tree with foliage')
    await approach(bot, work.pos, signal)
    let cut = 0
    // Cut the full detected trunk, not just the first section.
    // Re-scan in short passes so newly reachable blocks are also collected.
    for (let pass = 0; pass < trunk.length + 2; pass++) {
      let progressed = false
      for (const pos of trunk) {
        signal.throwIfAborted()
        const block = bot.blockAt(pos, false)
        if (!block || !logs.has(block.name)) continue
        if (!canReach(bot, block)) {
          try { await approach(bot, pos, signal) } catch { continue }
        }
        const target = bot.blockAt(pos, false)
        if (!target || !logs.has(target.name) || !canReach(bot, target)) continue
        await harvest(bot, { kind: 'mine', name: target.name, pos, label: work.label }, project, radius, signal, true)
        cut++
        progressed = true
      }
      if (!progressed) break
    }
    if (!cut) throw new Error('No reachable trunk blocks')
    return
  }
  if (work.kind === 'mine') return harvest(bot, work, project, radius, signal)
  if (work.kind === 'plant') {
    const ground = bot.blockAt(work.pos.offset(0, -1, 0), false)
    if (!ground || !['grass_block', 'dirt', 'coarse_dirt', 'podzol', 'rooted_dirt', 'mud'].includes(ground.name)) throw new Error('Planting spot is no longer valid soil')
    if (!isAir(bot.blockAt(work.pos, false)?.name)) throw new Error('Planting spot is occupied')
    await approach(bot, work.pos, signal)
    const item = bot.inventory.items().find(i => i.name === work.sapling)
    if (!item) throw new Error('No sapling in inventory')
    await untilAbort(bot.equip(item, 'hand'), signal)
    if (bot.heldItem?.name !== work.sapling) throw new Error('Sapling not equipped')
    if (!isAir(bot.blockAt(work.pos, false)?.name)) throw new Error('Planting spot became occupied')
    const target = bot.blockAt(work.pos, false)
    if (!target) throw new Error('Planting spot is unloaded')
    const support = placementSupports(bot, work.pos).find(({ block }) => block.position.offset(0, 1, 0).equals(work.pos))
    if (!support) throw new Error('No support face for planting')
    await untilAbort(bot.lookAt(center(support.block.position).plus(support.face.scaled(.5)), true), signal)
    await untilAbort(bot.placeBlock(support.block, support.face), signal)
    if (bot.blockAt(work.pos, false)?.name !== work.sapling) throw new Error('Server did not accept the sapling')
    return
  }
  if (work.kind === 'smelt') return smeltIron(bot, work.pos, project, signal, pending)
  if (work.kind === 'store') {
    const currentWindow = () => bot.currentWindow
    if (currentWindow()) throw new Error('An inventory window is open')
    await approach(bot, work.pos, signal)
    const block = bot.blockAt(work.pos, false)
    if (!block || !['chest', 'barrel'].includes(block.name) || !canReach(bot, block)) throw new Error('Storage chest is missing or not reachable')
    signal.throwIfAborted()
    const opening = bot.openChest(block)
    void opening.then(window => { if (signal.aborted && currentWindow()?.id === window.id) return window.close() }).catch(() => {})
    const chest = await untilAbort(opening, signal)
    try {
      const keep = new Set(work.keep ?? ['wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'bread', 'cooked_beef', 'torch'])
      const stowed: string[] = []
      for (const item of bot.inventory.items()) {
        signal.throwIfAborted()
        if (keep.has(item.name) || item.name.endsWith('_axe') || item.name.endsWith('_pickaxe') || item.name === 'bread' ||
          safeFoods.has(item.name) && bot.inventory.count(item.type, null) <= 4) continue
        const free = chest.items().filter(slot => !slot.name || slot.name === item.name)
          .reduce((space, slot) => space + (slot.name ? (64 - (slot.count ?? 0)) : 64), 0)
        if (free < 1) continue
        const deposited = Math.min(item.count, free)
        await untilAbort(chest.deposit(item.type, null, deposited), signal)
        stowed.push(`${item.name} x${deposited}`)
      }
      if (!stowed.length) throw new Error('Nothing to store; chest was not useful')
      log?.info?.({ chest: work.pos, stowed }, 'Stored spare inventory')
      return
    } finally {
      if (currentWindow()?.id === chest.id) await chest.close()
    }
  }
  if (work.kind === 'craft') {
    if (!crafts.has(work.name) || bot.currentWindow) throw new Error('Craft is not currently allowed')
    let table: LocalBlock | undefined
    if (work.table) {
      const reference = project.table
      if (!reference || work.table.x !== reference.x || work.table.y !== reference.y || work.table.z !== reference.z || !insideWorkArea(project.anchor, work.table, radius)) throw new Error('Only use the bot’s own crafting table')
      await approach(bot, work.table, signal)
      const block = bot.blockAt(work.table, false)
      if (block?.name !== 'crafting_table' || !canReach(bot, block)) throw new Error('Crafting table is missing or not reachable')
      table = block
    }
    const item = bot.registry.itemsByName[work.name]
    const recipe = item && bot.recipesFor(item.id, null, 1, table ?? null)[0]
    if (!item || !recipe) throw new Error('Ingredients are no longer available')
    const before = bot.inventory.count(item.id, null)
    signal.throwIfAborted()
    await untilAbort(bot.craft(recipe, 1, recipe.requiresTable ? table : undefined), signal)
    for (let i = 0; i < 5; i++) {
      if (bot.inventory.count(item.id, null) > before) return
      await delay(125, signal)
    }
    throw new Error('Craft was not reflected in the inventory')
  }
  if (bot.currentWindow) throw new Error('An inventory window is open')
  if (work.kind !== 'place') throw new Error('Unsupported placement job')
  // A bed is two blocks long and can orient away from the primary cell, so the
  // placed block may land in a horizontal neighbor; accept either result.
  const isBed = work.name.endsWith('_bed')
  const bedCellOk = (p: Vec3) => {
    const ground = bot.blockAt(p.offset(0, -1, 0), false)
    return ground && ground.boundingBox === 'block' && !dangerousBlocks.has(ground.name) && isAir(bot.blockAt(p, false)?.name)
  }
  const blueprint = work.purpose === 'house' || work.purpose === 'mineshaft'
  const cells: Array<{ pos: Vec3; role: string }> = blueprint ? blueprintCells((work.purpose === 'house' ? project.house : project.mineshaft)!, work.purpose as 'house' | 'mineshaft')
    : (work.purpose === 'shelter' ? shelterCells(project.shelter!) : workshopCells(project.workshop!)).map(pos => ({ pos, role: 'wall' }))
  const role = work.role
  const inCells = cells.some(cell => cell.pos.equals(work.pos))
  const protectedCell = protectedByProject(project, work.pos)
  const allowed = isBed
    ? bedCellOk(work.pos) && faces.slice(2).some(face => bedCellOk(work.pos.plus(face))) && !protectedCell
    : work.purpose === 'table' || work.purpose === 'furnace'
      ? work.name === (work.purpose === 'table' ? 'crafting_table' : 'furnace') && standable(bot, work.pos) && !protectedCell
      : inCells && (blueprint ? cells.some(cell => cell.pos.equals(work.pos) && (role ? cell.role === role : true) && roleAccepts(cell.role as never, work.name))
        : buildMaterials.has(work.name) || work.name === 'crafting_table' || work.name === 'furnace')
  if (!allowed) throw new Error('Placement would touch an unapproved or occupied cell')
  // Clear replaceable nonsolid growth (tall grass, ferns) before validating the cell.
  const clearCell = async (cell: Vec3) => {
    const occupant = bot.blockAt(cell, false)
    if (!isAir(occupant?.name) && occupant?.boundingBox === 'empty') {
      await untilAbort(bot.lookAt(center(occupant.position), true), signal)
      await untilAbort(bot.dig(occupant, 'ignore'), signal)
      if (!isAir(bot.blockAt(cell, false)?.name)) throw new Error('Placement cell could not be cleared of growth')
    }
  }
  await clearCell(work.pos)
  if (isBed) {
    // The bed extends in the facing direction; keep every neighbor cell clear.
    for (const face of faces.slice(2)) await clearCell(work.pos.plus(face))
  }
  if (!isAir(bot.blockAt(work.pos, false)?.name)) throw new Error('Placement would touch an unapproved or occupied cell')
  const supports = placementSupports(bot, work.pos)
  if (!supports.length) throw new Error('No ordinary support block')
  const reference = (from: Vec3, candidates = supports) => candidates.find(({ block, face }) => {
    const faceScaled = face.scaled(.499)
    // Line-of-sight check: the ray must actually reach THIS support block without
    // hitting something else first. The entry face may differ from the placement
    // face (e.g., looking up at a wall block from below); placeBlock uses the
    // geometric face (support -> target cell), so identity match is unnecessary.
    const hit = rayTo(bot, from, center(block.position).plus(faceScaled))
    return hit?.position?.equals(block.position)
  })
  const intersects = (p: Vec3, height: number) => Math.abs(p.x - work.pos.x - .5) < .85 && Math.abs(p.z - work.pos.z - .5) < .85 && p.y < work.pos.y + 1 && p.y + height > work.pos.y
  const otherOccupied = () => cellHasEntity(bot, work.pos)
  if (otherOccupied()) throw new Error('Placement is occupied by another entity')
  const height = bot.entity.height || 1.8
  const occupied = () => intersects(bot.entity.position, height) || otherOccupied()
  const from = eye(bot)
  if (!reference(from) || occupied()) {
    await goto(bot, new GoalForInteraction(bot, work.pos, from.y - bot.entity.position.y, (feet, eyes) => !intersects(feet, height) && Boolean(reference(eyes))), signal)
  }
  const item = bot.inventory.items().find(i => i.name === work.name)
  if (!item) throw new Error('No placement material')
  await untilAbort(bot.equip(item, 'hand'), signal)
  if (bot.heldItem?.name !== work.name) throw new Error('Placement material not equipped')
  // Retry a few times against ray flakiness and view-angle changes before giving up.
  for (let attempt = 0; attempt < 3; attempt++) {
    signal.throwIfAborted()
    const currentReference = () => reference(eye(bot), placementSupports(bot, work.pos))
    const target = currentReference()
    if (!target || occupied() || !isAir(bot.blockAt(work.pos, false)?.name)) {
      await goto(bot, new GoalForInteraction(bot, work.pos, from.y - bot.entity.position.y, (feet, eyes) => !intersects(feet, height) && Boolean(reference(eyes))), signal)
      continue
    }
    await untilAbort(bot.lookAt(center(target.block.position).plus(target.face.scaled(.5)), true), signal)
    signal.throwIfAborted()
    if (occupied() || !isAir(bot.blockAt(work.pos, false)?.name)) continue
    const still = currentReference()
    if (!still || !still.block.position.equals(target.block.position)) continue
    await untilAbort(bot.placeBlock(target.block, target.face), signal)
    // A bed may orient into a horizontal neighbor instead of the primary cell.
    if (isBed
      ? [work.pos, ...faces.slice(2).map(face => work.pos.plus(face))].some(cell => bot.blockAt(cell, false)?.name.endsWith('_bed'))
      : bot.blockAt(work.pos, false)?.name === work.name) return
  }
  throw new Error('Placement face or destination changed')
}
