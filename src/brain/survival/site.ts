import type { Bot } from 'mineflayer'
import { Vec3 } from 'vec3'
import type { Point } from '../../types/decisions'
import type { SurvivalProject } from '../../types/state'
import { dangerousBlocks, point, vec } from '../../bot/perception'
import { buildMaterials, isAir, surface } from './types'

export function insideWorkArea(anchor: Point, pos: Point, radius: number): boolean {
  return Math.hypot(anchor.x - pos.x, anchor.z - pos.z) <= radius && Math.abs(anchor.y - pos.y) <= 10
}

export function standable(bot: Bot, pos: Vec3): boolean {
  const ground = bot.blockAt(pos.offset(0, -1, 0), false)
  return Boolean(ground && ground.boundingBox === 'block' && !dangerousBlocks.has(ground.name) &&
    isAir(bot.blockAt(pos, false)?.name) && isAir(bot.blockAt(pos.offset(0, 1, 0), false)?.name))
}

/** True when a player or mob overlaps the cell volume; used to avoid placing into living entities. */
export function cellHasEntity(bot: Bot, pos: Vec3, includeBot = false): boolean {
  const hit = (p: Vec3, h: number) =>
    Math.abs(p.x - pos.x - .5) < .85 && Math.abs(p.z - pos.z - .5) < .85 && p.y < pos.y + 1 && p.y + h > pos.y
  return Object.values(bot.entities).some(e => e.isValid && (includeBot || e !== bot.entity) &&
    (e.type === 'player' || e.type === 'mob') && hit(e.position, e.height || 1.8))
}

/**
 * Blueprint helper: gives a small 4x4 starter cabin plus a furnished "big house"
 * and an owned mineshaft entry. Every cell uses the block role at build time;
 * decorative cells the planner cannot fill (leaves, flowers) are simply skipped.
 */
export type Role = 'wall' | 'floor' | 'roof' | 'entry' | 'window' | 'interior' | 'torch' | 'door' | 'stairs' | 'chest' | 'crafting_table' | 'furnace' | 'bed' | 'shaft' | 'shaftStairs'

function cells(origin: Point, size: number, height: number): Array<{ pos: Vec3; role: Role }> {
  const start = vec(origin), cells: Array<{ pos: Vec3; role: Role }> = []
  for (let y = 0; y < height; y++) for (let x = 0; x < size; x++) for (let z = 0; z < size; z++) {
    const border = x === 0 || z === 0 || x === size - 1 || z === size - 1
    if (y === 0) { if (border) cells.push({ pos: start.offset(x, y, z), role: 'floor' }); continue }
    if (y === height - 1) { cells.push({ pos: start.offset(x, y, z), role: 'roof' }); continue }
    if (!border) { cells.push({ pos: start.offset(x, y, z), role: 'interior' }); continue }
    // South face (+z) hosts the entry; ground-level border corners stay solid.
    if (z === size - 1 && y === 1 && x === Math.floor(size / 2)) cells.push({ pos: start.offset(x, y, z), role: 'entry' })
    else if (y === 1 && !((x === 0 || x === size - 1) && (z === 0 || z === size - 1)) && (x + z) % 3 === 1) cells.push({ pos: start.offset(x, y, z), role: 'window' })
    else cells.push({ pos: start.offset(x, y, z), role: 'wall' })
  }
  return cells
}

/** Small starter cabin: 4x4 walls, roof, entry, one window per side. */
export function shelterCells(origin: Point): Vec3[] {
  return cells(origin, 4, 3).filter(c => c.role !== 'interior' && c.role !== 'entry').map(c => c.pos)
}

/** Two story furnished house: interior floors, stairs, chest, torches, bed area. */
export function houseCells(origin: Point): Array<{ pos: Vec3; role: Role }> {
  const list = cells(origin, 6, 6)
  const at = (x: number, y: number, z: number, role: Role) => {
    const hit = list.find(cell => cell.pos.equals(vec(origin).offset(x, y, z)))
    if (hit) hit.role = role
  }
  at(1, 1, 4, 'door'); at(2, 2, 4, 'door')
  at(4, 1, 1, 'chest'); at(4, 1, 2, 'chest'); at(1, 1, 1, 'crafting_table'); at(1, 1, 2, 'furnace'); at(4, 1, 4, 'bed')
  at(3, 1, 3, 'stairs')
  at(4, 2, 4, 'stairs'); at(4, 3, 3, 'stairs'); at(4, 3, 2, 'stairs'); at(4, 4, 2, 'stairs')
  for (const [x, z] of [[1, 1], [4, 4], [1, 4], [4, 1]] as const) { at(x, 2, z, 'torch'); at(x, 4, z, 'torch') }
  return list.filter(cell => cell.role !== 'interior')
}

/** Straight staircase mineshaft: descending shaft with stair steps and torch anchors. */
export function mineshaftCells(origin: Point): Array<{ pos: Vec3; role: Role }> {
  const start = vec(origin), out: Array<{ pos: Vec3; role: Role }> = []
  const depth = 6
  for (let step = 0; step <= depth; step++) {
    const pos = start.offset(step, -step, 0)
    out.push({ pos: pos.offset(0, -1, 0), role: step === depth ? 'floor' : 'shaftStairs' })
    for (const dy of [0, 1]) out.push({ pos: pos.offset(0, dy, -1), role: 'shaft' })
    out.push({ pos, role: 'shaft' })
    if (step > 0 && step % 2 === 0) out.push({ pos: pos.offset(0, 1, 0), role: 'torch' })
  }
  return out
}

function roleBlocks(role: Role): string[] {
  switch (role) {
    case 'roof': return ['oak_stairs', 'spruce_stairs', 'cobblestone_stairs', 'oak_slab', 'cobblestone']
    case 'stairs': case 'shaftStairs': return ['oak_stairs', 'cobblestone_stairs']
    case 'window': return ['glass_pane', 'glass']
    case 'door': return ['oak_door', 'spruce_door', 'birch_door']
    case 'torch': return ['torch', 'wall_torch']
    case 'chest': return ['chest', 'barrel']
    case 'bed': return ['white_bed', 'red_bed']
    default: return [...buildMaterials]
  }
}

/** Which palette satisfies each blueprint role. */
export function roleBlocksFor(role: Role): readonly string[] {
  return roleBlocks(role)
}

export type Furnishing = Extract<Role, 'chest' | 'crafting_table' | 'furnace' | 'bed' | 'torch' | 'door' | 'stairs' | 'shaftStairs'>

/** Which roles exist in a blueprint and how many cells need each. */
export function roleCounts(list: Array<{ pos: Vec3; role: Role }>): Map<Role, number> {
  return list.reduce((counts, cell) => counts.set(cell.role, (counts.get(cell.role) ?? 0) + 1), new Map())
}

export function blueprintCells(origin: Point, kind: 'shelter' | 'house' | 'mineshaft'): Array<{ pos: Vec3; role: Role }> {
  return kind === 'shelter' ? cells(origin, 4, 3).filter(c => c.role !== 'interior')
    : kind === 'house' ? houseCells(origin) : mineshaftCells(origin)
}

/** Accept any listed material for a role, or any already-placed block from that role's palette. */
export function roleAccepts(role: Role, name: string): boolean {
  return roleBlocks(role).includes(name)
}

/** Open sides keep the workshop accessible; the exterior step provides roof access. */
export function workshopCells(origin: Point): Vec3[] {
  const start = vec(origin), cells = [start.offset(0, 0, -1)]
  for (let y = 0; y < 2; y++) for (const x of [0, 2]) for (const z of [0, 2]) cells.push(start.offset(x, y, z))
  for (let x = 0; x < 3; x++) for (let z = 0; z < 3; z++) cells.push(start.offset(x, 2, z))
  return cells
}

export function structureComplete(bot: Bot, cells: Vec3[]): boolean {
  return cells.length > 0 && cells.every(p => buildMaterials.has(bot.blockAt(p, false)?.name ?? ''))
}

export function onStructurePlot(pos: Point, origin: Point, size: number, margin = 1): boolean {
  return pos.x >= origin.x - margin && pos.x < origin.x + size + margin && pos.z >= origin.z - margin && pos.z < origin.z + size + margin
}

export function protectedByProject(project: SurvivalProject, pos: Point): boolean {
  return ([[project.shelter, 4], [project.workshop, 3], [project.house, 6], [project.mineshaft, 6]] as const).some(([site, size]) =>
    site && pos.y >= site.y - 7 && pos.y <= site.y + 7 && onStructurePlot(pos, site, size)) ||
    [project.table, project.furnace].some(site => site && site.x === pos.x && site.z === pos.z && pos.y === site.y - 1)
}

export function flatShelterSite(bot: Bot, start: Vec3, size = 4): boolean {
  for (let x = -1; x <= size; x++) for (let z = -1; z <= size; z++) {
    const pos = start.offset(x, 0, z)
    if (!surface.has(bot.blockAt(pos.offset(0, -1, 0), false)?.name ?? '')) return false
    for (let y = 0; y < 3; y++) {
      // Replaceable nonsolid growth (tall grass, ferns) is clearable; only real obstacles block a site.
      const block = bot.blockAt(pos.offset(0, y, 0), false)
      if (!isAir(block?.name) && block?.boundingBox !== 'empty') return false
    }
  }
  return true
}

export function findSite(bot: Bot, anchor: Point, radius: number): Point | undefined {
  const at = bot.entity.position.floored()
  for (const distance of [5, 8, 11, 14]) for (let i = 0; i < 8; i++) for (const y of [0, 1, -1, 2, -2]) {
    const angle = i * Math.PI / 4
    const pos = at.offset(Math.round(Math.cos(angle) * distance) - 1, y, Math.round(Math.sin(angle) * distance) - 1)
    if (insideWorkArea(anchor, pos, radius - 6) && Math.abs(anchor.y - pos.y) <= 8 && flatShelterSite(bot, pos)) return point(pos)
  }
  return undefined
}

export function findWorkshopSite(bot: Bot, project: SurvivalProject, radius: number): Point | undefined {
  if (!project.shelter) return undefined
  const home = vec(project.shelter)
  for (const distance of [6, 8, 10]) for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
    const pos = home.offset(x * distance, 0, z * distance)
    if (insideWorkArea(project.anchor, pos, radius - 4) && flatShelterSite(bot, pos, 3)) return point(pos)
  }
  return undefined
}

export function findHouseSite(bot: Bot, project: SurvivalProject, radius: number): Point | undefined {
  if (!project.shelter) return undefined
  const home = vec(project.shelter)
  for (const distance of [10, 13, 16]) for (let i = 0; i < 8; i++) for (const y of [0, 1, -1]) {
    const angle = i * Math.PI / 4
    const pos = home.offset(Math.round(Math.cos(angle) * distance), y, Math.round(Math.sin(angle) * distance))
    if (insideWorkArea(project.anchor, pos, radius) && flatShelterSite(bot, pos, 6)) return point(pos)
  }
  return undefined
}

export function findMineshaftSite(bot: Bot, project: SurvivalProject, radius: number): Point | undefined {
  const at = bot.entity.position.floored()
  for (let i = 0; i < 8; i++) {
    const angle = i * Math.PI / 4
    const pos = at.offset(Math.round(Math.cos(angle) * 5), -1, Math.round(Math.sin(angle) * 5))
    const ground = bot.blockAt(pos.offset(0, -1, 0), false)
    if (insideWorkArea(project.anchor, pos, radius - 4) && ground && ground.boundingBox === 'block' &&
      !dangerousBlocks.has(ground.name) && bot.blockAt(pos, false)?.boundingBox !== 'block') return point(pos)
  }
  return undefined
}
