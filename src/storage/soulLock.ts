import { randomUUID } from 'node:crypto'
import { closeSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'

export function lockSoulFile(path: string): () => void {
  const lock = `${path}.lock`
  const owner = JSON.stringify({ pid: process.pid, host: hostname(), token: randomUUID() }) + '\n'
  let fd: number
  try { fd = openSync(lock, 'wx', 0o600) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    let details = ''
    try {
      const existing = JSON.parse(readFileSync(lock, 'utf8')) as { pid?: unknown; host?: unknown }
      if (typeof existing.pid === 'number' && typeof existing.host === 'string') details = ` (PID ${existing.pid} on ${existing.host})`
    } catch { /* The owner may still be writing the lock. */ }
    throw new Error(`Soul save already locked${details}: ${lock}. Use a different save or stop its owner.`)
  }
  try {
    try { writeFileSync(fd, owner) } finally { closeSync(fd) }
  } catch (error) {
    unlinkSync(lock)
    throw error
  }
  let released = false
  return () => {
    if (released) return
    released = true
    try {
      if (readFileSync(lock, 'utf8') === owner) unlinkSync(lock)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
}
