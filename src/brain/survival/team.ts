import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { Config } from '../../config'
import type { Work } from './types'

export function teamJobKey(work: Work) {
  const pos = work.kind === 'craft' ? work.table : work.kind === 'walk' ? undefined : work.pos
  return pos ? `block:${pos.x},${pos.y},${pos.z}` : undefined
}

export class TeamBoard {
  private readonly owner = randomUUID()
  private name: string
  constructor(private readonly db: DatabaseSync, readonly id: string, name: string, readonly home: NonNullable<Config['TEAM_HOME']>) {
    this.name = name
    db.exec(`PRAGMA busy_timeout=100;
      CREATE TABLE IF NOT EXISTS claims (target TEXT PRIMARY KEY, owner TEXT NOT NULL, until_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS peers (owner TEXT PRIMARY KEY, name TEXT NOT NULL, activity TEXT NOT NULL, until_at INTEGER NOT NULL);`)
  }
  identify(name: string) { this.name = name }
  report(activity: string, now = Date.now()) {
    this.db.prepare('DELETE FROM peers WHERE until_at <= ?').run(now)
    this.db.prepare(`INSERT INTO peers VALUES (?, ?, ?, ?) ON CONFLICT(owner) DO UPDATE SET name=excluded.name, activity=excluded.activity, until_at=excluded.until_at`)
      .run(this.owner, this.name, activity, now + 60_000)
  }
  peers(now = Date.now()) {
    return this.db.prepare('SELECT name, activity FROM peers WHERE owner != ? AND until_at > ? ORDER BY name LIMIT 8').all(this.owner, now)
      .map(row => ({ name: String(row.name), activity: String(row.activity) }))
  }
  unavailable(now = Date.now()) {
    return new Set(this.db.prepare('SELECT target FROM claims WHERE owner != ? AND until_at > ?').all(this.owner, now).map(row => String(row.target)))
  }
  claim(targets: readonly string[], ttl: number, now = Date.now()) {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare('DELETE FROM claims WHERE until_at <= ?').run(now)
      const insert = this.db.prepare('INSERT OR IGNORE INTO claims VALUES (?, ?, ?)')
      for (const target of new Set(targets)) {
        if (!Number(insert.run(target, this.owner, now + ttl).changes)) {
          this.db.exec('ROLLBACK')
          return false
        }
      }
      this.db.exec('COMMIT')
      return true
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  release(target: string) { this.db.prepare('DELETE FROM claims WHERE target = ? AND owner = ?').run(target, this.owner) }
  offline() { this.db.prepare('DELETE FROM peers WHERE owner = ?').run(this.owner) }
  close() {
    try { this.offline(); this.db.prepare('DELETE FROM claims WHERE owner = ?').run(this.owner) } finally { this.db.close() }
  }
}

export async function openTeam(config: Config) {
  if (!config.TEAM_ID || !config.TEAM_HOME) return undefined
  const { DatabaseSync } = await import('node:sqlite').catch(() => { throw new Error('Team mode requires Node 24 LTS with node:sqlite') })
  const scope = createHash('sha256').update(JSON.stringify([config.MC_HOST.toLowerCase(), config.MC_PORT, config.TEAM_ID, config.TEAM_HOME])).digest('hex').slice(0, 24)
  const dir = join('data', 'teams')
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const db = new DatabaseSync(join(dir, `${scope}.sqlite`))
  try { return new TeamBoard(db, config.TEAM_ID, config.SOULBOT_INSTANCE ?? 'companion', config.TEAM_HOME) }
  catch (error) { db.close(); throw error }
}
