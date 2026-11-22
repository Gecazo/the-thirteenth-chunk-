import type { Vec3 } from 'vec3'
import type { Bot } from 'mineflayer'

export const wood = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry', 'pale_oak']
export const logs = new Set(wood.map(type => `${type}_log`))
export const planks = new Set(wood.map(type => `${type}_planks`))
export const surface = new Set(['grass_block', 'dirt', 'coarse_dirt', 'podzol', 'stone', 'cobblestone', 'sand', 'gravel', 'snow_block', 'deepslate'])
export const buildMaterials = new Set([...planks, 'cobblestone'])
export const ironOres = new Set(['iron_ore', 'deepslate_iron_ore'])
export const coalOres = new Set(['coal_ore', 'deepslate_coal_ore'])
/** Easy bare-hand dig targets: keep the bot productive when wood/stone paths are blocked. */
export const soilBlocks = new Set(['dirt', 'grass_block', 'coarse_dirt', 'podzol', 'sand', 'red_sand', 'gravel'])
export const smeltingFuels = ['coal', 'charcoal', ...planks]
export const isAir = (name?: string) => name === 'air' || name === 'cave_air' || name === 'void_air'
export const center = (p: Vec3) => p.offset(.5, .5, .5)
export const eye = (bot: Bot) => bot.entity.position.offset(0, ('eyeHeight' in bot.entity && typeof bot.entity.eyeHeight === 'number') ? bot.entity.eyeHeight : 1.62, 0)
export type Travel = { kind: 'walk'; label: string; pos: Vec3; purpose?: 'return' }
export type Mining = { kind: 'mine'; label: string; pos: Vec3; name: string }
export type Work =
  | Mining
  | { kind: 'tree'; label: string; pos: Vec3 }
  | { kind: 'craft'; label: string; name: string; table?: Vec3 }
  | { kind: 'place'; label: string; pos: Vec3; name: string; purpose: 'table' | 'shelter' | 'furnace' | 'workshop' | 'house' | 'mineshaft'; role?: string }
  | { kind: 'smelt'; label: string; pos: Vec3 }
  | { kind: 'plant'; label: string; pos: Vec3; sapling: string }
  | { kind: 'store'; label: string; pos: Vec3; keep?: string[] }
  | { kind: 'furnish'; label: string; pos: Vec3; name: string; purpose: 'house' | 'mineshaft'; role: string }
  | Travel
export type LocalBlock = NonNullable<ReturnType<Bot['blockAt']>>
