import { playerName } from '../config'
import type { AgentState } from '../types/state'
import type { SensedEntity } from '../types/decisions'

export function trustFor(s: AgentState, player: string) { return s.social.find(x => x.player.toLowerCase() === player.toLowerCase())?.trust ?? .5 }
export function observePlayers(s: AgentState, players: SensedEntity[], at: number): void {
  for (const { name } of players) {
    if (!playerName.safeParse(name).success) continue
    const known = s.social.find(x => x.player.toLowerCase() === name.toLowerCase())
    if (known) known.lastSeen = at
    else if (s.social.length < 100) s.social.push({ player: name, trust: .5, lastSeen: at })
  }
}
