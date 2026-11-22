import type { Bot } from 'mineflayer'
import { Vec3 } from 'vec3'
import type { PerceptionFrame, Point, SensedEntity } from '../types/decisions'
import type { AgentState } from '../types/state'
import { clamp } from '../types/state'
import type { Config } from '../config'
import { safeFoods } from '../behaviors/eatIfHungry'
import { bedHours, overworld } from '../brain/sleep/sleepTrigger'

export const vec = (p: Point) => new Vec3(p.x, p.y, p.z)
export const point = ({ x, y, z }: Point): Point => ({ x, y, z })
const hostileNames = new Set(['creeper', 'zombie', 'skeleton', 'husk', 'drowned', 'stray', 'witch', 'phantom', 'blaze', 'ghast',
  'magma_cube', 'slime', 'hoglin', 'zoglin', 'pillager', 'ravager', 'vex', 'warden', 'wither', 'guardian', 'elder_guardian', 'cave_spider', 'shulker', 'silverfish'])
export const dangerousBlocks = new Set(['lava', 'fire', 'soul_fire', 'cactus', 'magma_block', 'campfire', 'soul_campfire', 'powder_snow', 'sweet_berry_bush', 'wither_rose', 'nether_portal', 'end_portal'])

export function hostilesNear(bot: Bot, radius: number): SensedEntity[] {
  return Object.values(bot.entities).filter(e => e.isValid && (e.kind === 'Hostile mobs' || hostileNames.has(e.name ?? '')))
    .map(e => ({ id: e.id, name: e.name ?? 'monster', distance: e.position.distanceTo(bot.entity.position), position: point(e.position) }))
    .filter(e => e.distance <= radius).sort((a, b) => a.distance - b.distance || a.id - b.id)
}

export function blockHazard(bot: Bot): string | null {
  const foot = bot.entity.position.floored()
  for (const p of [foot, foot.offset(0, 1, 0), foot.offset(0, -1, 0)]) {
    const block = bot.blockAt(p, false)
    if (block && dangerousBlocks.has(block.name)) return block.name
  }
  return null
}

export function playerEntity(bot: Bot, name: string) {
  const key = Object.keys(bot.players).find(k => k.toLowerCase() === name.toLowerCase())
  const e = key ? bot.players[key]?.entity : undefined
  return e?.isValid && e.id !== bot.entity.id ? e : undefined
}

export function isFreeBedHead(bot: Bot, block: ReturnType<Bot['blockAt']>): boolean {
  if (!block || !bot.isABed(block)) return false
  const { occupied, part } = block.getProperties()
  return occupied !== true && occupied !== 'true' && part !== 'foot'
}

export function bedFree(bot: Bot, p: Point) {
  const block = bot.blockAt(vec(p), false)
  return isFreeBedHead(bot, block) ? block : null
}

export class Perception {
  private bedCache: { expires: number; dimension: string; center: Vec3; beds: Point[] } | undefined
  private lastDamage: PerceptionFrame['lastDamage'] = null
  constructor(private readonly bot: Bot, private readonly config: Config) {}
  damage(at: number, source: string, environmentalNeed: boolean) { this.lastDamage = { at, source, environmentalNeed } }
  sampleDamage() { return this.lastDamage }
  reset() { this.lastDamage = null; this.bedCache = undefined }
  sample(at: number, s: AgentState): PerceptionFrame {
    const bot = this.bot, position = bot.entity.position, dimension = bot.game.dimension, radius = this.config.PERCEPTION_RADIUS
    const timeOfDay = ((Math.floor(bot.time.timeOfDay || 0) % 24000) + 24000) % 24000
    const thunder = bot.isRaining && bot.thunderState > 0
    const day = Math.max(0, Math.floor(bot.time.day || 0))
    const inventory: PerceptionFrame['inventory'] = { occupiedSlots: 0, foodCount: 0, items: {} }
    for (const item of bot.inventory.items()) {
      inventory.occupiedSlots++
      inventory.items[item.name] = (inventory.items[item.name] ?? 0) + item.count
      if (safeFoods.has(item.name)) inventory.foodCount += item.count
    }
    const neighbors = Object.values(bot.entities).filter(e => e.id !== bot.entity.id && e.isValid)
      .map(entity => ({ entity, distance: entity.position.distanceTo(position) })).filter(e => e.distance <= radius)
      .sort((a, b) => a.distance - b.distance || a.entity.id - b.entity.id)
    const sensed = ({ entity, distance }: typeof neighbors[number]) => ({ id: entity.id, name: entity.username ?? entity.name ?? entity.type, distance, position: point(entity.position) })
    const players = neighbors.filter(e => e.entity.type === 'player').slice(0, 32).map(sensed)
    const forageId = inventory.foodCount ? null : neighbors.find(e => {
      if (e.distance > 8 || e.entity.name !== 'item') return false
      const dropped = e.entity.getDroppedItem()
      return dropped && safeFoods.has(dropped.name)
    })?.entity.id ?? null
    let beds: Point[] = []
    if (this.config.ENABLE_SLEEP && overworld(dimension) && (bedHours({ timeOfDay, thunder }) || s.runtime.sleepRequested)) {
      const cached = this.bedCache
      if (!cached || cached.expires <= at || cached.dimension !== dimension || cached.center.distanceTo(position) > 5) {
        // Mineflayer also calls the matcher for positionless section-palette entries.
        beds = bot.findBlocks({ matching: block => isFreeBedHead(bot, block), maxDistance: radius, count: 12 }).map(point)
        this.bedCache = { expires: at + 6000, dimension, center: position.clone(), beds }
      } else beds = cached.beds
      beds = beds.filter(p => vec(p).distanceTo(position) <= radius && bedFree(bot, p)).sort((a, b) => vec(a).distanceTo(position) - vec(b).distanceTo(position))
    }
    const target = s.runtime.following ? playerEntity(bot, s.runtime.following) : undefined
    return { at, day, timeOfDay, dimension, thunder, sleeping: bot.isSleeping,
      position: point(position), health: clamp(bot.health, 20), food: clamp(bot.food, 20), breath: bot.oxygenLevel ?? 20, inventory,
      nearby: neighbors.slice(0, 40).map(sensed), hostiles: hostilesNear(bot, radius).slice(0, 20), players, beds,
      hazard: blockHazard(bot), lastDamage: this.lastDamage, followVisible: Boolean(target && target.position.distanceTo(position) <= radius), forageId }
  }
}
