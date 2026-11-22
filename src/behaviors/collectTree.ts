import type { Bot } from 'mineflayer'
import type { Vec3 } from 'vec3'
import type { SurvivalProject } from '../types/state'
import { insideWorkArea, protectedByProject } from '../brain/survival/site'
import { logs } from '../brain/survival/types'

const soil = new Set(['grass_block', 'dirt', 'coarse_dirt', 'podzol', 'rooted_dirt', 'mud', 'mycelium', 'moss_block'])

/** Recognize upright trunks rooted in soil and with a nearby canopy. No scaffolding or leaf breaking. */
export function treeTrunk(bot: Bot, base: Vec3, project: SurvivalProject, radius: number): Vec3[] {
  if (!insideWorkArea(project.anchor, base, radius) || protectedByProject(project, base) ||
      !soil.has(bot.blockAt(base.offset(0, -1, 0), false)?.name ?? '')) return []
  const trunk: Vec3[] = []
  for (let y = 0; y < 8; y++) {
    const pos = base.offset(0, y, 0), block = bot.blockAt(pos, false)
    if (!block || !logs.has(block.name)) break
    if (!insideWorkArea(project.anchor, pos, radius) || protectedByProject(project, pos)) return []
    trunk.push(pos)
  }
  if (trunk.length < 2) return []
  const canopy = trunk.at(-1)!
  for (const y of [-1, 0, 1]) for (const [x, z] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    if (bot.blockAt(canopy.offset(x, y, z), false)?.name.endsWith('_leaves')) return trunk
  }
  return []
}
