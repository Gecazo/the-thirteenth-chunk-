import { readFileSync } from 'node:fs'
import { extname } from 'node:path'
import { eventSchema } from '../types/memory'
import { stateSchema } from '../types/state'
import { errorMessage } from '../infra/errors'
import { emptySoul, soulSnapshot, type SoulSnapshot } from './soulDocument'
import { createSoulFile } from './soulFile'

async function readSqlite(path: string): Promise<unknown> {
  // SQLite is loaded only by this one-time importer, never when running the bot.
  const { DatabaseSync } = await import('node:sqlite').catch(() => {
    throw new Error('Importing a SQLite save requires Node 24 LTS (or another Node version with node:sqlite)')
  })
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    const rows = (sql: string): unknown[] => db.prepare(sql).all().map(row => {
      if (typeof row.body !== 'string') throw new Error('Invalid legacy row')
      return JSON.parse(row.body) as unknown
    })
    const saved = db.prepare('SELECT body FROM state WHERE key = ?')
    const get = (key: string): unknown => {
      const value = saved.get(key)?.body
      return typeof value === 'string' ? JSON.parse(value) as unknown : undefined
    }
    const sleeps = Object.fromEntries(db.prepare('SELECT day, body FROM sleep ORDER BY day').all().map(row => {
      if (typeof row.body !== 'string') throw new Error('Invalid legacy sleep row')
      return [String(row.day), JSON.parse(row.body) as unknown]
    }))
    return { ...emptySoul(), state: get('agent'), events: get('stm') ?? [], sleeps,
      memories: rows('SELECT body FROM memory ORDER BY at DESC, id LIMIT 2000'),
      audit: rows('SELECT body FROM (SELECT id, body FROM audit ORDER BY id DESC LIMIT 2000) ORDER BY id'),
    }
  } finally { db.close() }
}

export async function importLegacy(source: string, destination: string): Promise<SoulSnapshot> {
  const raw: unknown = extname(source).toLowerCase() === '.json'
    ? JSON.parse(readFileSync(source, 'utf8')) : await readSqlite(source)
  const snapshot = soulSnapshot.parse(raw)
  stateSchema.parse(snapshot.state)
  snapshot.events.forEach(event => eventSchema.parse(event))
  createSoulFile(destination, snapshot)
  return snapshot
}

if (require.main === module) {
  const [source, destination = './soul.md', ...extra] = process.argv.slice(2)
  if (!source || extra.length) {
    console.error('Usage: npm run import:soul -- <old.sqlite|old.json> [new-soul.md]')
    process.exitCode = 1
  } else {
    void importLegacy(source, destination).then(() => console.log(`Imported into ${destination}. The source was not modified.`)).catch(error => {
      console.error('Soul import failed:', errorMessage(error)); process.exitCode = 1
    })
  }
}
