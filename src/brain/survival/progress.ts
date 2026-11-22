import type { Bot } from 'mineflayer'
import { milestones, type Milestone, type SurvivalProject } from '../../types/state'
import { shelterCells, structureComplete, workshopCells, houseCells, mineshaftCells, roleAccepts } from './site'

export function newMilestones(bot: Bot, project: SurvivalProject): Milestone[] {
  const inventory = bot.inventory.items()
  const reached: Record<Milestone, boolean> = {
    stone_tools: inventory.some(item => /^(stone|iron|diamond|netherite)_pickaxe$/.test(item.name)),
    home: Boolean(project.shelter && structureComplete(bot, shelterCells(project.shelter))),
    iron_tools: inventory.some(item => /^(iron|diamond|netherite)_pickaxe$/.test(item.name)),
    workshop: Boolean(project.workshop && structureComplete(bot, workshopCells(project.workshop))),
    house: Boolean(project.house && houseCells(project.house).every(cell => roleAccepts(cell.role, bot.blockAt(cell.pos, false)?.name ?? 'air'))),
    mineshaft: Boolean(project.mineshaft && mineshaftCells(project.mineshaft).every(cell => roleAccepts(cell.role, bot.blockAt(cell.pos, false)?.name ?? 'air'))),
  }
  return milestones.filter(m => reached[m] && !project.milestones?.includes(m))
}
