import type { Bot } from 'mineflayer'
import { PNG } from 'pngjs'
import { Vec3 } from 'vec3'
import { eye as positionOfEyes, isAir } from './types'

const width = 128, height = 80, scale = 2
type Pixel = [number, number, number]
const known: Record<string, Pixel> = {
  grass_block: [104, 149, 57], dirt: [125, 85, 55], stone: [129, 131, 137], deepslate: [67, 69, 76], cobblestone: [99, 102, 109],
  sand: [221, 208, 147], water: [40, 105, 202], lava: [248, 110, 25], snow: [231, 244, 249], snow_block: [236, 245, 252],
  crafting_table: [143, 98, 52], coal_ore: [62, 63, 66], iron_ore: [160, 128, 103], gravel: [142, 135, 130],
}
function color(name: string): Pixel {
  if (known[name]) return known[name]
  if (name.endsWith('_leaves') || name === 'vine' || name.includes('grass')) return [64, 121, 47]
  if (name.endsWith('_log')) return [105, 76, 48]
  if (name.endsWith('_planks')) return [183, 143, 97]
  if (name.endsWith('_bed')) return [163, 56, 58]
  return [127, 120, 112]
}

/** Small headless first-person image, from the bot's view direction and loaded chunks only. */
export function renderWorldView(bot: Bot): string {
  const eye = positionOfEyes(bot)
  const { yaw, pitch } = bot.entity
  const forward = new Vec3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch))
  const right = new Vec3(Math.cos(yaw), 0, -Math.sin(yaw))
  const up = right.cross(forward)
  const png = new PNG({ width: width * scale, height: height * scale })
  const sky: Pixel = bot.time.isDay ? [118, 173, 224] : [35, 52, 88]
  const lookup = new Map<number, Pixel | null>()
  const cell = new Vec3(0, 0, 0), base = eye.floored()
  for (let py = 0; py < height; py++) for (let px = 0; px < width; px++) {
    const u = ((px + .5) / width - .5) * 1.48, v = (.5 - (py + .5) / height) * .925
    const dx = forward.x + u * right.x + v * up.x, dy = forward.y + v * up.y, dz = forward.z + u * right.z + v * up.z
    let sample = sky, light = 1, last = -1, yLast = eye.y
    for (let t = .3; t < 22; t += .52) {
      const x = Math.floor(eye.x + dx * t), y = Math.floor(eye.y + dy * t), z = Math.floor(eye.z + dz * t)
      const key = ((x - base.x + 32) * 64 + y - base.y + 32) * 64 + z - base.z + 32
      if (key === last) continue
      last = key
      let hit = lookup.get(key)
      if (hit === undefined) {
        cell.set(x, y, z)
        const block = bot.blockAt(cell, false)
        hit = !block || isAir(block.name) ? null : color(block.name)
        lookup.set(key, hit)
      }
      if (hit) {
        sample = hit
        light = (y === yLast ? .83 : 1) * (1 - t * .016)
        break
      }
      yLast = y
    }
    for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) {
      const at = ((py * scale + sy) * png.width + px * scale + sx) * 4
      png.data[at] = Math.round(sample[0] * light)
      png.data[at + 1] = Math.round(sample[1] * light)
      png.data[at + 2] = Math.round(sample[2] * light)
      png.data[at + 3] = 255
    }
  }
  return PNG.sync.write(png).toString('base64')
}
