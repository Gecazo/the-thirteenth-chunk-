import { randomBytes } from 'node:crypto'

export function seededRng(seed = randomBytes(4).readUInt32LE()): () => number {
  let n = seed >>> 0
  return () => {
    n = (Math.imul(1664525, n) + 1013904223) >>> 0
    return n / 0x100000000
  }
}
