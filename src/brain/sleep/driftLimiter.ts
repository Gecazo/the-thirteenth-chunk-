import { clamp } from '../../types/state'

export function limitedDelta(before: number, delta: number, maxDrift: number): number {
  return clamp(before + Math.min(maxDrift, Math.max(-maxDrift, delta)))
}
export function exceedsDrift(delta: number, limit: number): boolean { return Math.abs(delta) > limit + Number.EPSILON }
