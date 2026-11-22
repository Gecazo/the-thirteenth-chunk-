import type { Bot } from 'mineflayer'
import { PNG } from 'pngjs'
import { Vec3 } from 'vec3'
import { isAir } from '../brain/survival/types'
import { dangerousBlocks } from '../bot/perception'
import type { Point } from '../types/decisions'

type Pixel = [number, number, number]
const known: Record<string, Pixel> = {
  grass_block: [104, 149, 57], dirt: [125, 85, 55], stone: [129, 131, 137], deepslate: [67, 69, 76],
  cobblestone: [99, 102, 109], sand: [221, 208, 147], water: [40, 105, 202], lava: [248, 110, 25],
  gravel: [142, 135, 130], snow_block: [236, 245, 252], crafting_table: [143, 98, 52], furnace: [110, 110, 112],
  coal_ore: [62, 63, 66], iron_ore: [160, 128, 103], bedrock: [40, 40, 40], glass: [200, 220, 230],
}
function color(name: string): Pixel {
  if (known[name]) return known[name]
  if (name.endsWith('_leaves') || name === 'vine' || name === 'short_grass' || name === 'fern') return [64, 121, 47]
  if (name.endsWith('_log')) return [105, 76, 48]
  if (name.endsWith('_planks')) return [183, 143, 97]
  if (name.endsWith('_bed')) return [163, 56, 58]
  if (name === 'chest' || name === 'barrel') return [176, 129, 60]
  if (name === 'torch' || name === 'wall_torch') return [255, 200, 60]
  if (name.endsWith('_door')) return [130, 100, 62]
  if (name.endsWith('_stairs') || name.endsWith('_slab')) return [150, 130, 105]
  if (name.endsWith('_glass_pane') || name === 'glass_pane') return [200, 220, 230]
  return [127, 120, 112]
}
const put = (png: PNG, x: number, y: number, p: Pixel) => {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) return
  const at = (y * png.width + x) * 4
  png.data[at] = p[0]; png.data[at + 1] = p[1]; png.data[at + 2] = p[2]; png.data[at + 3] = 255
}
const putDot = (png: PNG, x: number, y: number, p: Pixel) => {
  put(png, x, y, p); put(png, x + 1, y, p); put(png, x, y + 1, p); put(png, x + 1, y + 1, p)
}

/** Top-down height map of loaded chunks around the bot; white=bot, red=hostile, cyan=player. */
export function renderTopDown(bot: Bot, radius: number, outlines: Array<[Point, number, Pixel]> = []): string {
  const at = bot.entity.position.floored()
  const r = Math.max(8, Math.min(Math.floor(radius), 48))
  const size = r * 2 + 1
  const png = new PNG({ width: size, height: size })
  const probe = new Vec3(0, 0, 0)
  const top = at.y + 10, bottom = at.y - 24
  for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
    const x = at.x + dx, z = at.z + dz
    let pixel: Pixel = [16, 20, 26] // unloaded chunk
    for (let y = top; y >= bottom; y--) {
      probe.set(x, y, z)
      const block = bot.blockAt(probe, false)
      if (block && !isAir(block.name)) {
        pixel = dangerousBlocks.has(block.name) ? [90, 20, 10] : color(block.name)
        break
      }
    }
    put(png, dx + r, dz + r, pixel)
  }
  const toPixel = (position: { x: number; z: number }) => ({ px: Math.round(position.x - at.x) + r, py: Math.round(position.z - at.z) + r })
  // Structure outlines passed in by the caller are drawn after terrain but before entities.
  for (const outline of outlines) {
    const [origin, span, pixel] = outline as [{ x: number; y: number; z: number }, number, Pixel]
    for (const [dx, dz] of [...Array.from({ length: span }, (_, i) => [i, 0]), ...Array.from({ length: span }, (_, i) => [i, span - 1]), ...Array.from({ length: span - 2 }, (_, i) => [0, i + 1]), ...Array.from({ length: span - 2 }, (_, i) => [span - 1, i + 1])] as Array<[number, number]>) {
      const { px, py } = toPixel({ x: origin.x + dx, z: origin.z + dz })
      put(png, px, py, pixel)
    }
  }
  for (const entity of Object.values(bot.entities)) {
    if (!entity.isValid || entity === bot.entity) continue
    const { px, py } = toPixel(entity.position)
    if (entity.type === 'player') putDot(png, px, py, [80, 220, 230])
    else if (entity.kind === 'Hostile mobs' || ['creeper', 'zombie', 'skeleton', 'spider', 'witch'].includes(entity.name ?? '')) putDot(png, px, py, [230, 60, 60])
    else if (entity.name === 'item') put(png, px, py, [250, 240, 120])
  }
  putDot(png, r, r, [255, 255, 255])
  return PNG.sync.write(png).toString('base64')
}
