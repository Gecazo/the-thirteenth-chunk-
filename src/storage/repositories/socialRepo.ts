import { stateSchema } from '../../types/state'
import type { Storage } from '../types'

export class SocialRepo {
  constructor(private readonly storage: Storage) {}
  read(player: string) {
    return this.storage.social().flatMap(raw => {
      const entry = stateSchema.shape.social.element.safeParse(raw)
      return entry.success ? [entry.data] : []
    }).find(s => s.player.toLowerCase() === player.toLowerCase())
  }
}
