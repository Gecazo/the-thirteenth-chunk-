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

export function shelterCells(origin: Point): Vec3[] {
  const pos = vec(origin), cells: Vec3[] = []
  // Floors are left intact. The two-block entry faces south (+z).
  for (let y = 0; y <= 2; y++) for (let x = 0; x < 4; x++) for (let z = 0; z < 4; z++) {
    if (y < 2 && ((x > 0 && x < 3 && z > 0 && z < 3) || (x === 1 && z === 3))) continue
    cells.push(pos.offset(x, y, z))
  }
  return cells
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
  return ([[project.shelter, 4], [project.workshop, 3]] as const).some(([site, size]) =>
    site && pos.y >= site.y - 1 && pos.y <= site.y + 2 && onStructurePlot(pos, site, size)) ||
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
