import type { Bot } from 'mineflayer'
import { Vec3 } from 'vec3'
import { dangerousBlocks, vec } from '../../bot/perception'
import type { SurvivalProject } from '../../types/state'
import { buildMaterials, center, coalOres, ironOres, isAir, logs, planks, smeltingFuels, soilBlocks, surface, type LocalBlock, type Travel, type Work } from './types'
import { findSite, findWorkshopSite, findHouseSite, findMineshaftSite, insideWorkArea, protectedByProject, shelterCells, standable, structureComplete, workshopCells, houseCells, mineshaftCells, roleAccepts, roleBlocksFor } from './site'
import { treeTrunk } from '../../behaviors/collectTree'

export const faces = [new Vec3(0, 1, 0), new Vec3(0, -1, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1), new Vec3(1, 0, 0), new Vec3(-1, 0, 0)] as const
const ores = new Set(['stone', ...coalOres, ...ironOres])
export const isPick = (name: string) => /^(wooden|stone|iron|golden|diamond|netherite)_pickaxe$/.test(name)

export function placementSupports(bot: Bot, pos: Vec3) {
  return faces.flatMap(face => {
    const block = bot.blockAt(pos.minus(face), false)
    // Do not use interactable blocks as a placement support.
    return block && (surface.has(block.name) || buildMaterials.has(block.name)) ? [{ block, face }] : []
  })
}

/** Standalone soil-dig eligibility: exposed soft blocks the bot can dig with a bare hand. */
export function diggableSoil(bot: Bot, block: LocalBlock, project: SurvivalProject, radius: number): boolean {
  const pos = block.position, feet = bot.entity.position.floored()
  // Depth window is generous (±4): the bot walks a sloping shore between job offer and
  // execution, and a sand two blocks lower at offer time can be four lower on arrival.
  if (!soilBlocks.has(block.name) || !insideWorkArea(project.anchor, pos, radius) || pos.y < feet.y - 4) return false
  if (feet.x === pos.x && feet.z === pos.z && pos.y <= feet.y) return false
  if (protectedByProject(project, pos)) return false
  if (faces.some(face => dangerousBlocks.has(bot.blockAt(pos.plus(face), false)?.name ?? ''))) return false
  // Skip soil with soil stacked above (gravity churn makes these jobs stale) and soil
  // touching water: digging it floods the neighbors and the follow-up jobs go stale.
  const above = bot.blockAt(pos.offset(0, 1, 0), false)
  if (above && soilBlocks.has(above.name)) return false
  if (faces.some(face => bot.blockAt(pos.plus(face), false)?.name.includes('water'))) return false
  return faces.some(face => isAir(bot.blockAt(pos.plus(face), false)?.name))
}

export function mineable(bot: Bot, block: LocalBlock, project: SurvivalProject, radius: number): boolean {
  const pos = block.position, feet = bot.entity.position.floored()
  // Same sloping-terrain allowance as diggableSoil: offers are re-checked after walking.
  if (!insideWorkArea(project.anchor, pos, radius) || pos.y < feet.y - 4) return false
  if (feet.x === pos.x && feet.z === pos.z && pos.y <= feet.y) return false
  if (protectedByProject(project, pos)) return false
  if (faces.some(face => dangerousBlocks.has(bot.blockAt(pos.plus(face), false)?.name ?? ''))) return false
  if (logs.has(block.name)) {
    // Only trunks with foliage close to the targeted section, not exposed log walls or furniture.
    for (let dy = 0; dy <= 3; dy++) for (const edge of faces) {
      if (bot.blockAt(pos.offset(edge.x, dy, edge.z), false)?.name.endsWith('_leaves')) return true
    }
    return false
  }
  if (soilBlocks.has(block.name)) {
    // Easy surface dig: exposed like ores; covers dirt, sand, gravel and friends.
    // Skip soil with more soil stacked on top (gravity churn: digging support sand
    // makes the column fall and the same cell keeps re-offering stale jobs) and soil
    // touching water (digging it floods the neighborhood and every follow-up job fails).
    // Exposure accepts ANY face (incl. top) — diggableSoil offers top-exposed blocks;
    // a horizontal-only check here would reject exactly what was offered.
    const above = bot.blockAt(pos.offset(0, 1, 0), false)
    if (above && soilBlocks.has(above.name)) return false
    if (faces.some(face => bot.blockAt(pos.plus(face), false)?.name.includes('water'))) return false
    return faces.some(face => isAir(bot.blockAt(pos.plus(face), false)?.name))
  }
  if (!ores.has(block.name)) return false
  // A surface face must be exposed; never start a tunnel or remove a floor by mining down.
  return faces.slice(2).some(face => isAir(bot.blockAt(pos.plus(face), false)?.name))
}

export function workKey(w: Work): string {
  return w.kind === 'craft' ? `craft:${w.name}:${w.table ?? ''}` : `${w.kind}:${w.pos}`
}

function candidates(bot: Bot, names: Set<string>, radius: number, eligible: (block: LocalBlock) => boolean, count = 2): Vec3[] {
  const matching = [...names].flatMap(name => {
    const block = bot.registry.blocksByName[name]
    return block ? [block.id] : []
  })
  // Filter before the nearest-N limit; otherwise buried stone fills the results in normal terrain.
  return matching.length ? bot.findBlocks({ matching, maxDistance: radius, count, useExtraInfo: block =>
    block.position.distanceTo(bot.entity.position) <= radius + 1 && eligible(block),
  }) : []
}

const miningJob = (block: LocalBlock): Work => ({ kind: 'mine', label: `Gather ${block.name}`, name: block.name, pos: block.position })
type Placement = Extract<Work, { kind: 'place' }>

function availableCraft(bot: Bot, name: string, table?: Vec3): Work | undefined {
  const id = bot.registry.itemsByName[name]?.id
  if (id === undefined) return undefined
  const recipe = bot.recipesFor(id, null, 1, Boolean(table))[0]
  if (!recipe) return undefined
  return { kind: 'craft', label: `Craft ${name}`, name, ...(recipe.requiresTable ? { table } : {}) }
}

export const visitKey = (p: Vec3) => `${Math.floor(p.x / 6)},${Math.floor(p.z / 6)}`

const saplings = new Set(['oak_sapling', 'birch_sapling', 'spruce_sapling', 'acacia_sapling', 'jungle_sapling', 'dark_oak_sapling', 'cherry_sapling'])
const saplingForLog = (logName: string): string => {
  const type = logName.replace('_log', '')
  return type === 'pale_oak' ? 'oak_sapling' : `${type}_sapling`
}

/** Find a clear, standable dirt/grass spot with daylight sky access for replanting a sapling. */
export function replantSpot(bot: Bot, near: Vec3, project: SurvivalProject, radius: number, visited: Map<string, number>, blocked: (w: Work) => boolean, sapling: string): Work | undefined {
  const spots: Vec3[] = []
  for (const dx of [-2, -1, 0, 1, 2]) for (const dz of [-2, -1, 0, 1, 2]) for (const dy of [0, 1, -1]) {
    const pos = near.offset(dx, dy, dz)
    if (visited.has(visitKey(pos)) || blocked({ kind: 'plant', label: 'Plant sapling', pos, sapling })) continue
    const ground = bot.blockAt(pos.offset(0, -1, 0), false)
    if (!ground || !['grass_block', 'dirt', 'coarse_dirt', 'podzol', 'rooted_dirt', 'mud'].includes(ground.name)) continue
    if (!standable(bot, pos) || protectedByProject(project, pos) || !insideWorkArea(project.anchor, pos, radius)) continue
    spots.push(pos)
  }
  const pos = spots.sort((a, b) => center(a).distanceTo(bot.entity.position) - center(b).distanceTo(bot.entity.position))[0]
  return pos ? { kind: 'plant', label: `Plant ${sapling.replaceAll('_', ' ')}`, pos, sapling } : undefined
}

export function exploreOptions(bot: Bot, project: SurvivalProject, radius: number, visited: Map<string, number>): Travel[] {
  const options: Travel[] = []
  const at = bot.entity.position.floored()
  for (let index = 0; index < 8; index++) {
    const a = index * Math.PI / 4
    for (const d of [14, 9, 6]) {
      const dest = [0, 1, -1, 2, -2].map(y => at.offset(Math.round(Math.cos(a) * d), y, Math.round(Math.sin(a) * d)))
        .find(p => insideWorkArea(project.anchor, p, radius - 2) && standable(bot, p))
      if (dest) { options.push({ kind: 'walk', label: `Explore ${['east', 'southeast', 'south', 'southwest', 'west', 'northwest', 'north', 'northeast'][index]}`, pos: dest }); break }
    }
  }
  return options.sort((a, b) => (visited.get(visitKey(a.pos)) ?? 0) - (visited.get(visitKey(b.pos)) ?? 0))
}

export function enumerateWork(bot: Bot, project: SurvivalProject, radius: number, goal: string | null, visited: Map<string, number>, blocked: (w: Work) => boolean): Work[] {  const choices: { work: Work; priority: number }[] = []
  const inventory = bot.inventory.items()
  const count = (set: Set<string>) => inventory.reduce((n, item) => n + (set.has(item.name) ? item.count : 0), 0)
  const number = (name: string) => inventory.reduce((n, item) => n + (item.name === name ? item.count : 0), 0)
  const hasPick = inventory.some(item => isPick(item.name))
  const stoneOrBetter = inventory.some(item => /^(stone|iron|diamond|netherite)_pickaxe$/.test(item.name))
  const ironOrBetter = inventory.some(item => /^(iron|diamond|netherite)_pickaxe$/.test(item.name))
  const upgrade = !stoneOrBetter
  const woodOnHand = count(logs), plankCount = count(planks), material = inventory.filter(item => buildMaterials.has(item.name))
    .sort((a, b) => b.count - a.count || a.slot - b.slot)[0]
  const add = (work: Work | undefined, priority: number) => { if (work && !blocked(work)) choices.push({ work, priority }) }
  const wantsBuild = /\b(?:build|shelter|cabin|home|house|hut|expand|workshop)\b/i.test(goal ?? '')
  const wantsTools = /\b(?:mine|pickaxe|tools|stone|coal|iron)\b/i.test(goal ?? '')
  const shelter = project.shelter ? shelterCells(project.shelter) : []
  const workshop = project.workshop ? workshopCells(project.workshop) : []
  const homeDone = structureComplete(bot, shelter)
  const building = homeDone ? workshop : shelter
  const remaining = building.filter(p => isAir(bot.blockAt(p, false)?.name))
  const buildingOpen = !homeDone || remaining.length > 0 || !project.workshop
  const ironNeed = !ironOrBetter && (homeDone || project.milestones?.includes('home') === true)
  const ingots = number('iron_ingot'), rawIron = number('raw_iron')
  const hasFuel = smeltingFuels.some(name => number(name) > 0)
  const explorations = exploreOptions(bot, project, radius, visited)
  // Wood availability decides whether soil-digging fillers are worth offering.
  const woodVisible = candidates(bot, logs, Math.min(22, radius), block => mineable(bot, block, project, radius)).length > 0 ||
    candidates(bot, logs, Math.min(22, radius), b => treeTrunk(bot, b.position, project, radius).length > 0).length > 0

  if (plankCount < (buildingOpen ? 14 : 5)) for (const item of inventory.filter(item => logs.has(item.name)).slice(0, 2)) {
    add(availableCraft(bot, item.name.replace(/_log$/u, '_planks')), plankCount < 4 ? 102 : 68)
  }
  if (material && remaining.length) {
    // Only expose the next accessible cell. Build walls from bottom to top and roof last.
    const lowest = remaining[0]?.y
    const best = remaining.filter(p => p.y === lowest && insideWorkArea(project.anchor, p, radius) && placementSupports(bot, p).length)
      .sort((a, b) => center(a).distanceTo(bot.entity.position) - center(b).distanceTo(bot.entity.position))
    const purpose = homeDone ? 'workshop' : 'shelter'
    const jobs = best.map((pos): Placement => ({ kind: 'place', label: `Build ${purpose} with ${material.name}`, name: material.name, pos, purpose }))
    for (const job of jobs.filter(w => !blocked(w)).slice(0, 2)) add(job, wantsBuild ? 106 : homeDone ? 88 : hasPick ? 94 : 60)
  }
  const house = project.house
  if (house) {
    const blueprint = houseCells(house), shaft = project.mineshaft ? mineshaftCells(project.mineshaft) : []
    const roleAt = (cell: { pos: Vec3; role: string }) => bot.blockAt(cell.pos, false)?.name ?? 'air'
    const unfilled = (list: Array<{ pos: Vec3; role: string }>) => list.filter(cell => !roleAccepts(cell.role as never, roleAt(cell)))
    const pendingHouse = unfilled(blueprint), pendingShaft = unfilled(shaft)
    const furnish = (cell: { pos: Vec3; role: string }, purpose: 'house' | 'mineshaft'): Work | undefined => {
      const name = roleBlocksFor(cell.role as never).find(name => number(name) > 0)
      return name ? { kind: 'furnish', label: `Furnish ${cell.role.replaceAll('_', ' ')} with ${name}`, pos: cell.pos, name, purpose, role: cell.role } : undefined
    }
    for (const cell of pendingHouse.filter(cell => cell.pos.y === Math.min(...pendingHouse.map(c => c.pos.y))).slice(0, 2)) {
      const job = furnish(cell, 'house')
      if (job && !blocked(job)) add(job, 100)
    }
    for (const cell of pendingShaft.filter(cell => cell.pos.y === Math.max(...pendingShaft.map(c => c.pos.y))).slice(0, 1)) {
      const job = furnish(cell, 'mineshaft')
      if (job && !blocked(job)) add(job, 96)
    }
    if (pendingHouse.length && number('oak_stairs') + number('cobblestone_stairs') < 2) add(availableCraft(bot, 'oak_stairs', project.table ? vec(project.table) : undefined), 99)
    if (pendingHouse.length && number('chest') < 2) add(availableCraft(bot, 'chest', project.table ? vec(project.table) : undefined), 98)
  }
  const storage = project.house ? houseCells(project.house).find(cell => ['chest', 'barrel'].includes(bot.blockAt(cell.pos, false)?.name ?? '')) : undefined
  if (storage && inventory.length > 20) {
    const job: Work = { kind: 'store', label: 'Store spare items in chest', pos: storage.pos }
    if (!blocked(job)) add(job, 92)
  }
  const shelterOrigin = project.shelter
  const planksOrCobble = new Set([...planks, 'cobblestone'])
  // Bed goes on the shelter floor inside; walls are build material, floors are left intact.
  const bedInShelter = shelterOrigin ? [...Array(2)].flatMap((_, dx) => [...Array(2)].map((_, dz) => vec(shelterOrigin).offset(1 + dx, 1, 1 + dz)))
    .find(pos => isAir(bot.blockAt(pos, false)?.name) && planksOrCobble.has(bot.blockAt(pos.offset(0, -1, 0), false)?.name ?? '')) : undefined
  const heldBed = bot.inventory.items().find(item => item.name.endsWith('_bed'))
  if (heldBed && bedInShelter) {
    const job: Work = { kind: 'place', label: 'Place own bed in shelter', pos: bedInShelter, name: heldBed.name, purpose: 'shelter' }
    if (!blocked(job)) add(job, 113)
  }
  function station(purpose: 'table' | 'furnace', name: string, use: boolean, priority: number, craftTable?: Vec3): Vec3 | undefined {
    const saved = project[purpose]
    if (saved && insideWorkArea(project.anchor, saved, radius)) {
      const pos = vec(saved), block = bot.blockAt(pos, false)
      if (block?.name === name) return pos
      // Unloaded is not destroyed. Travel back rather than overwriting the saved station.
      if (!block) {
        if (use) {
          const work = explorations.filter(w => !blocked(w) && w.pos.distanceTo(pos) < bot.entity.position.distanceTo(pos))
            .sort((a, b) => a.pos.distanceTo(pos) - b.pos.distanceTo(pos))[0]
          if (work) add({ ...work, label: `Return toward own ${name}`, purpose: 'return' }, priority)
        }
        return undefined
      }
    }
    if (!use) return undefined
    if (!number(name)) add(availableCraft(bot, name, craftTable), priority - 5)
    else {
      const at = bot.entity.position.floored()
      const nearHome = project.shelter && vec(project.shelter).distanceTo(at) <= 21 ? vec(project.shelter) : undefined
      const targets = [...(nearHome ? [nearHome.offset(5, 0, 1), nearHome.offset(-2, 0, 1), nearHome.offset(3, 0, 5)] : []), ...faces.slice(2).map(dir => at.plus(dir.scaled(2)))]
      for (const pos of targets) {
        if (!insideWorkArea(project.anchor, pos, radius) || !standable(bot, pos) || protectedByProject(project, pos)) continue
        const job = { kind: 'place' as const, label: `Place own ${name.replaceAll('_', ' ')}`, name, pos, purpose }
        if (!blocked(job)) { add(job, priority); break }
      }
    }
    return undefined
  }
  const table = station('table', 'crafting_table', true, 105)
  const furnace = station('furnace', 'furnace', ironNeed && ingots < 3 && (rawIron > 0 || project.smelting === true), 108, table)
  if (number('stick') < 2 && (!hasPick || upgrade || ironNeed || number('coal') > 0)) add(availableCraft(bot, 'stick'), 108)
  if (table && !hasPick) add(availableCraft(bot, 'wooden_pickaxe', table), 110)
  if (table && upgrade) add(availableCraft(bot, 'stone_pickaxe', table), 116)
  if (table && !ironOrBetter) add(availableCraft(bot, 'iron_pickaxe', table), 119)
  if (furnace && ingots < 3 && (project.smelting || (rawIron > 0 && hasFuel))) add({ kind: 'smelt', label: 'Smelt or collect iron', pos: furnace }, 115)
  if (number('torch') < 8) add(availableCraft(bot, 'torch'), 79)
  if (number('bread') < 3) add(availableCraft(bot, 'bread', table), bot.food < 13 ? 120 : 70)

  if (inventory.length < 35) {
    const search = Math.min(22, radius)
    const suggestMine = (names: Set<string>, priority: number, usePick = false) => {
      for (const pos of candidates(bot, names, search, block => mineable(bot, block, project, radius) && !blocked(miningJob(block)) &&
        (!usePick || inventory.some(item => isPick(item.name) && block.canHarvest(item.type))))) {
        const block = bot.blockAt(pos, false)
        if (block) add(miningJob(block), priority)
      }
    }
    if (woodOnHand < 4 && (plankCount < 5 || (buildingOpen && plankCount < 16))) {
      const treeJob = (pos: Vec3): Work => ({ kind: 'tree', label: 'Harvest reachable tree trunk', pos })
      const priority = plankCount < 4 && !woodOnHand ? 90 : 64
      // Offer any wood type: oak, birch, spruce, acacia, jungle... whatever is nearby.
      for (const pos of candidates(bot, logs, search, b => !blocked(treeJob(b.position)) && !!treeTrunk(bot, b.position, project, radius).length)) {
        const trunk = treeTrunk(bot, pos, project, radius)
        add(treeJob(pos), priority + 4)
        // Replant a matching sapling next to the stump to keep forests renewable.
        const sapling = saplingForLog(bot.blockAt(pos, false)!.name)
        const saplingCount = inventory.reduce((n, item) => n + (item.name === sapling ? item.count : 0), 0)
        if (saplings.has(sapling) && saplingCount > 0 && trunk.length) {
          const plant = replantSpot(bot, trunk[0]!, project, radius, visited, blocked, sapling)
          if (plant) add(plant, priority + 2)
        }
      }
      // Standalone exposed logs (fallen trunks, partial canopies) without a full trunk scan.
      suggestMine(logs, priority)
    }
    // When no wood/stone job is being offered right now, keep the bot's hands busy
    // with bare-hand soil digging instead of standing still.
    if (!woodVisible && inventory.length < 30) {
      for (const pos of candidates(bot, soilBlocks, search, block => diggableSoil(bot, block, project, radius))) {
        const block = bot.blockAt(pos, false)
        if (block) add({ kind: 'mine', label: `Dig ${block.name}`, name: block.name, pos: block.position }, 30)
      }
    }
    const cobble = number('cobblestone')
    if (hasPick && (cobble < 8 || (buildingOpen && cobble < 14))) {
      // Sand and dirt cover most surface stone: dig through the cover first. The stone
      // beneath only becomes eligible once exposed, so offer dig-jobs for the blocks
      // directly above stone within reach of the pickaxe.
      const stone = bot.registry.blocksByName.stone
      if (stone) {
        const digJob = (block: LocalBlock): Work => ({ kind: 'mine', label: `Dig ${block.name} to uncover stone`, name: block.name, pos: block.position })
        for (const pos of candidates(bot, soilBlocks, search, block =>
          block.position.distanceTo(bot.entity.position) <= search + 1 && diggableSoil(bot, block, project, radius) &&
          // Only cover blocks that actually hide stone directly below or beside them.
          [block.position.offset(0, -1, 0), ...faces.slice(2).map(f => block.position.plus(f))]
            .some(n => bot.blockAt(n, false)?.name === 'stone'), 2)) {
          const block = bot.blockAt(pos, false)
          if (block && !blocked(digJob(block))) add(digJob(block), upgrade && cobble < 3 ? 110 : wantsTools ? 84 : 58)
        }
      }
      suggestMine(new Set(['stone']), upgrade && cobble < 3 ? 112 : ironNeed && rawIron && !furnace && !number('furnace') && cobble < 8 ? 106 : wantsTools ? 83 : 56, true)
    }
    if (stoneOrBetter && ironNeed && rawIron + ingots < 3 && !project.smelting) suggestMine(ironOres, 112, true)
    if (hasPick && number('coal') < 4) suggestMine(coalOres, ironNeed && (rawIron > 0 || project.smelting) && !hasFuel ? 117 : wantsTools ? 83 : 52, true)
  }
  for (const work of explorations.filter(w => !blocked(w)).slice(0, 3)) add(work, 24)
  choices.sort((a, b) => b.priority - a.priority)
  // The model can arbitrate close calls, but not repeatedly skip critical prerequisites.
  const top = choices[0]?.priority ?? 0
  return choices.filter(({ priority }) => top - priority <= 15).map(({ work }) => work).slice(0, 9)
}

export function maybeChooseSite(bot: Bot, project: SurvivalProject, radius: number): SurvivalProject {
  if (!project.shelter) {
    const shelter = findSite(bot, project.anchor, radius)
    return shelter ? { ...project, shelter } : project
  }
  if (!project.workshop && structureComplete(bot, shelterCells(project.shelter))) {
    const workshop = findWorkshopSite(bot, project, radius)
    if (workshop) return { ...project, workshop }
  }
  if (project.workshop && !project.house && structureComplete(bot, workshopCells(project.workshop))) {
    const house = findHouseSite(bot, project, radius)
    if (house) return { ...project, house }
  }
  if (project.house && !project.mineshaft) {
    const mineshaft = findMineshaftSite(bot, project, radius)
    if (mineshaft) return { ...project, mineshaft }
  }
  return project
}
