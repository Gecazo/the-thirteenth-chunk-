import { randomUUID } from 'node:crypto'
import { closeSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { z } from 'zod'
import { emptySoul, parseSoulDocument, renderSoulDocument, soulSnapshot, type SoulSnapshot } from './soulDocument'
import type { Storage } from './types'
import { lockSoulFile } from './soulLock'

function readExisting(path: string): string | undefined {
  try { return readFileSync(path, 'utf8') } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return undefined
  }
}

function writeDocument(path: string, text: string, previous: string | undefined): void {
  const temporary = `${path}.${randomUUID()}.tmp`
  let created = false
  try {
    const fd = openSync(temporary, 'wx', 0o600)
    created = true
    try { writeFileSync(fd, text, { flush: true }) } finally { closeSync(fd) }
    if (previous === undefined) linkSync(temporary, path) // Atomic first write; never overwrite an existing file.
    else {
      if (readExisting(path) !== previous) throw new Error('The soul file changed outside the bot; stop and restart before writing it again')
      renameSync(temporary, path)
      created = false
    }
  } finally { if (created) unlinkSync(temporary) }
}

function localPath(path: string) {
  if (extname(path).toLowerCase() !== '.md') throw new Error('The soul file path must end in .md')
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const resolved = join(realpathSync(dirname(path)), basename(path))
  try {
    if (!lstatSync(resolved).isFile()) throw new Error('The soul save must be a regular file, not a symlink or directory')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  return resolved
}

export function createSoulFile(path: string, snapshot: SoulSnapshot): void {
  const target = localPath(path), release = lockSoulFile(target)
  try { writeDocument(target, renderSoulDocument(soulSnapshot.parse(snapshot)), undefined) } finally { release() }
}

export function openSoulFile(path: string): Storage {
  const target = localPath(path), release = lockSoulFile(target)
  let text: string | undefined, current: SoulSnapshot
  try {
    text = readExisting(target)
    current = text === undefined ? emptySoul() : parseSoulDocument(text)
  } catch (error) {
    release()
    throw new Error(`Cannot restore the checkpoint in ${target}; the original file was not changed`, { cause: error })
  }
  let closed = false
  const save = (next: SoulSnapshot) => {
    if (closed) throw new Error('The soul save is closed')
    const checked = soulSnapshot.parse(next)
    const updated = renderSoulDocument(checked)
    writeDocument(target, updated, text)
    text = updated
    current = checked
  }
  return {
    load: () => structuredClone({ state: text === undefined ? undefined : current.state, events: current.events }),
    memories: () => structuredClone(current.memories),
    social: () => structuredClone(z.object({ social: z.array(z.unknown()) }).safeParse(current.state).data?.social ?? []),
    slept: day => Object.hasOwn(current.sleeps, day),
    checkpoint: ({ state, events }) => save({ ...current, state, events }),
    commitSleep: ({ state, events, sleep, audit, memories }) => {
      if (Object.hasOwn(current.sleeps, sleep.day)) return false
      const ids = new Set(memories.map(m => m.id))
      save({ version: 1, state, events, sleeps: { ...current.sleeps, [sleep.day]: sleep },
        memories: [...memories, ...current.memories.filter(m => !ids.has(m.id))].sort((a, b) => b.at - a.at || a.id.localeCompare(b.id)).slice(0, 2000),
        audit: audit ? [...current.audit, audit].slice(-2000) : current.audit })
      return true
    },
    close: () => { closed = true; release() },
  }
}
