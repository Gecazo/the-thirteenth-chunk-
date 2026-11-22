import type { Action } from '../../types/state'

export class ActionBudget {
  private readonly until = new Map<Action, number>()
  ready(action: Action, now: number) { return now >= (this.until.get(action) ?? 0) }
  defer(action: Action, now: number, ms: number) { this.until.set(action, now + ms) }
  clear() { this.until.clear() }
}
