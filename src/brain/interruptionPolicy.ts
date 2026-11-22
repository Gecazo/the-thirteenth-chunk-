import type { Action } from '../types/state'

export function shouldInterrupt(current: Action, next: Action): boolean {
  if (current === next) return false
  if (next === 'RETREAT_TO_SAFETY' || next === 'STOP') return true
  if (current === 'RETREAT_TO_SAFETY') return false
  if (current === 'AUTONOMOUS') return next === 'EAT' || next === 'FOLLOW_PLAYER' || next === 'SEEK_BED' || next === 'SLEEP' || next === 'GATHER_BASIC'
  return current === 'FOLLOW_PLAYER' || current === 'GATHER_BASIC' || current === 'IDLE_SOCIAL' || current === 'PAUSE_AND_REFLECT'
}
