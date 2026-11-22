import type { Memory, MemoryEvent } from '../../types/memory'
import { milestoneNames, type Focus } from '../../types/state'
import { salience } from './salience'

export function consolidateMemories(events: MemoryEvent[], day: number, at: number, focuses: Focus[]): Memory[] {
  const ranked = events.map(e => ({ e, rank: salience(e, at) })).sort((a, b) => b.rank - a.rank || b.e.at - a.e.at)
  const count = (kind: MemoryEvent['kind']) => events.filter(e => e.kind === kind).length
  const avg = events.reduce((n, e) => n + e.valence, 0) / Math.max(1, events.length)
  const ate = count('ate'), company = count('company'), danger = count('danger') + count('damage') + count('died')
  const work = count('gathered') + count('crafted') + count('built')
  const memories: Memory[] = [{ id: `day:${day}`, at, day, kind: 'episodic', summary:
    `Day ${day}: ${events.length} notable events; ${company} moments of company, ${ate} meals, ${danger} danger signals.${work ? ` ${work} gathering, crafting, or building steps.` : ''}`,
  topics: [...new Set([...focuses, ...ranked.slice(0, 5).map(x => x.e.kind)])], valence: avg, salience: ranked[0]?.rank ?? .2 }]
  if (danger) memories.push({ id: 'belief:safety', at, day, kind: 'semantic', summary: 'Break off routine tasks when danger is close.', topics: ['danger', 'stay_safe'], valence: -.25, salience: .65 })
  if (company) memories.push({ id: `company:${day}`, at, day, kind: 'social', summary: `Spent time near other players on ${company} occasions.`, topics: ['company', 'share_company'], valence: .4, salience: .42 })
  if (ate) memories.push({ id: 'preference:nourishment', at, day, kind: 'preference', summary: 'Keep safe food available for the next trip.', topics: ['ate', 'eat_well'], valence: .3, salience: .45 })
  for (const milestone of new Set(events.flatMap(event => event.kind === 'milestone' && event.milestone ? [event.milestone] : []))) {
    memories.push({ id: `survival:${milestone}`, at, day, kind: 'episodic', summary: `Reached a survival milestone: ${milestoneNames[milestone]}.`, topics: ['milestone', milestone], valence: .8, salience: .8 })
  }
  const areas = new Set<string>()
  for (const { e, rank } of ranked) if (e.area && ['danger', 'damage', 'died'].includes(e.kind) && areas.size < 6 && !areas.has(e.area)) {
    areas.add(e.area)
    memories.push({ id: `danger:${e.area}`, at, day, kind: 'danger', summary: `Observed danger in area ${e.area}.`, topics: ['danger', 'stay_safe', e.area.slice(0, 40)], valence: e.valence, salience: rank })
  }
  return memories
}
