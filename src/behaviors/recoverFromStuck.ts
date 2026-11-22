import type { Bot } from 'mineflayer'
import type { Vec3 } from 'vec3'

export class ProgressWatch {
  private anchor?: Vec3
  private lastProgress = 0
  reset() { this.anchor = undefined }
  stuck(bot: Bot, at: number, shouldMove: boolean): boolean {
    const position = bot.entity.position
    if (!shouldMove || !this.anchor || position.distanceTo(this.anchor) >= .55) {
      this.anchor = position.clone(); this.lastProgress = at
    }
    return shouldMove && at - this.lastProgress >= 6500
  }
}
