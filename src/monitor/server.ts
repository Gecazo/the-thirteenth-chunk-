import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { Config } from '../config'
import type { MemoryEvent } from '../types/memory'
import type { Action, AgentState } from '../types/state'
import type { PerceptionFrame } from '../types/decisions'
import type { MonitorPatch, MonitorSink, MonitorThoughts } from './types'

interface Snapshot {
  updatedAt: number
  status: 'starting' | 'connected' | 'disconnected' | 'stopped'
  username: string | null
  reason: string | null
  state: AgentState | null
  perception: PerceptionFrame | null
  activeAction: Action | null
  activeJob: string | null
  jobSource: string | null
  team: MonitorPatch['team']
  thoughts: MonitorThoughts | null
  events: MemoryEvent[]
  notes: Array<{ at: number; level: 'info' | 'warn' | 'error'; message: string }>
}

interface MonitorControl {
  connect?: () => void
}

interface MonitorControl {
  connect?: () => void
}

const esc: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const safe = (s: string) => s.replace(/[&<>"']/g, c => esc[c] ?? c)

function html(url: string): string {
  const stateUrl = safe(url) + '/api/state'
  const stateUrlJson = JSON.stringify(url + '/api/state')
  const connectUrlJson = JSON.stringify(url + '/api/connect')
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>SoulBot Monitor</title>
  <style>
    :root { color-scheme: dark; --bg:#0b1118; --panel:#111b26; --line:#1f3144; --ink:#dce9f7; --muted:#8aa3bf; --ok:#4ade80; --warn:#facc15; --bad:#f87171; }
    * { box-sizing:border-box; }
    body { margin:0; background:var(--bg); color:var(--ink); font:14px/1.45 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Inter,sans-serif; }
    header { position:sticky; top:0; z-index:2; display:flex; gap:12px; align-items:center; padding:12px 16px; border-bottom:1px solid var(--line); background:rgba(11,17,24,.92); backdrop-filter: blur(6px); }
    header h1 { margin:0; font-size:16px; }
    .pill { padding:2px 8px; border-radius:999px; border:1px solid var(--line); color:var(--muted); }
    .ok { color:var(--ok); border-color:#1f6d43; }
    .warn { color:var(--warn); border-color:#6c5a1a; }
    .bad { color:var(--bad); border-color:#6b2424; }
    main { display:grid; gap:12px; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); padding:12px; }
    section { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:12px; min-height:110px; }
    h2 { margin:0 0 8px; font-size:14px; color:#c8d8ea; }
    .mono, pre { font-family: ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:12px; }
    pre { margin:0; white-space:pre-wrap; word-break:break-word; }
    .kv { display:grid; grid-template-columns:repeat(2,minmax(110px,1fr)); gap:6px 12px; }
    .k { color:var(--muted); }
    .v { text-align:right; }
    .list { margin:0; padding-left:18px; }
    table { width:100%; border-collapse:collapse; }
    th,td { padding:6px 4px; border-bottom:1px solid #18314a; text-align:left; vertical-align:top; }
    th { color:var(--muted); font-weight:600; }
    .small { font-size:12px; color:var(--muted); }
    .mapimg { width:100%; max-width:520px; image-rendering:pixelated; border-radius:8px; border:1px solid var(--line); background:var(--bg); }
  </style>
</head>
<body>
  <header>
    <h1>SoulBot Monitor</h1>
    <span id="status" class="pill">starting</span>
    <span id="who" class="pill">bot: -</span>
    <span id="updated" class="pill">updated: -</span>
    <a class="pill" href="${stateUrl}" target="_blank" rel="noreferrer">raw json</a>
    <button id="connectNow" class="pill" style="cursor:pointer;background:transparent;color:var(--ink)">Connect now</button>
  </header>
  <main>
    <section><h2>Thoughts / Decision</h2><pre id="thoughts" class="mono">No decisions yet.</pre></section>
    <section><h2>Vitals & Needs</h2><div id="vitals" class="kv"></div></section>
    <section><h2>Goals & Runtime</h2><pre id="goals" class="mono">-</pre></section>
    <section><h2>Learned skills &amp; team</h2><pre id="learning" class="mono">-</pre></section>
    <section><h2>Curated journal</h2><pre id="journal" class="mono">No curated notes yet.</pre></section>
    <section><h2>Inventory</h2><pre id="inventory" class="mono">-</pre></section>
    <section><h2>Nearby / Safety</h2><pre id="safety" class="mono">-</pre></section>
    <section><h2>Recent Events</h2><pre id="events" class="mono">-</pre></section>
    <section style="grid-column:1/-1"><h2>Map (top-down)</h2><img id="map" class="mapimg" alt="map" /><div class="small" id="mapinfo">white=bot · cyan=player · red=hostile · yellow=item drop</div></section>
    <section style="grid-column:1/-1"><h2>Raw state snapshot</h2><pre id="raw" class="mono">-</pre></section>
  </main>
  <script>
    const apiUrl = ${stateUrlJson}
    const connectUrl = ${connectUrlJson}
    const BR = String.fromCharCode(10)
    const fmt = function (n) { return typeof n === 'number' && Number.isFinite(n) ? n.toFixed(2).replace(/\\.00$/, '') : String(n) }
    const pct = function (n) { return typeof n === 'number' ? Math.round(n * 100) + '%' : '-' }
    const d = function (ts) { return typeof ts === 'number' ? new Date(ts).toLocaleTimeString() : '-' }
    function byCount(obj){
      return Object.entries(obj || {}).sort(function (a, b) { return Number(b[1]) - Number(a[1]) }).map(function (entry) {
        return String(entry[0]) + ': ' + String(entry[1])
      })
    }
    async function refresh(){
      let data
      try {
        const r = await fetch(apiUrl, { cache: 'no-store' })
        if (!r.ok) throw new Error(String(r.status))
        data = await r.json()
      } catch (e) {
        const status = document.getElementById('status')
        status.textContent = 'monitor offline'
        status.className = 'pill bad'
        return
      }
      const s = data.state || null
      const p = data.perception || null
      const t = data.thoughts || null
      const staleSec = data.updatedAt ? Math.floor((Date.now() - data.updatedAt) / 1000) : null
      const status = document.getElementById('status')
      status.textContent = String(data.status || 'unknown') + (staleSec !== null ? ' · ' + staleSec + 's ago' : '')
      status.className = 'pill ' + (data.status === 'connected' ? 'ok' : data.status === 'starting' ? 'warn' : 'bad')
      document.getElementById('who').textContent = 'bot: ' + (data.username || '-') + ' / ' + ((s && s.identity && s.identity.name) || '-')
      document.getElementById('updated').textContent = 'updated: ' + d(data.updatedAt)

      if (t){
        const top = (t.top || []).map(function (c) {
          const blocked = c.eligible ? '' : ' (blocked: ' + ((c.reasons || []).join('; ')) + ')'
          return '- ' + c.action + ': ' + fmt(c.score) + blocked
        }).join(BR)
        const blocked = (t.blocked || []).map(function (x) { return '- ' + x.action + ': ' + x.reasons.join('; ') }).join(BR) || '-'
        document.getElementById('thoughts').textContent = [
          'chosen: ' + (t.chosen && t.chosen.action ? t.chosen.action : '-') + ' (score ' + fmt(t.chosen && t.chosen.score) + ')',
          '', 'top candidates:', top || '-', '', 'blocked:', blocked,
        ].join(BR)
      }

      const vitals = []
      if (s){
        vitals.push(['health', fmt(s.vitals.health)], ['food', fmt(s.vitals.food)], ['energy', fmt(s.needs.energy)], ['sleepDebt', fmt(s.needs.sleepDebt)], ['hungerNeed', fmt(s.needs.hungerNeed)], ['safety', fmt(s.needs.safety)], ['loneliness', fmt(s.needs.loneliness)], ['boredom', fmt(s.needs.boredom)])
        vitals.push(['joy', pct(s.emotions.joy)], ['fear', pct(s.emotions.fear)], ['calm', pct(s.emotions.calm)], ['curiosity', pct(s.emotions.curiosity)])
      }
      document.getElementById('vitals').innerHTML = vitals.map(function (kv) { return '<div class="k">' + kv[0] + '</div><div class="v">' + kv[1] + '</div>' }).join('') || '<div class="small">No state yet.</div>'

      document.getElementById('goals').textContent = s ? [
        'active action: ' + (data.activeAction || s.runtime.lastAction || '-'),
        'current job: ' + (data.activeJob || '-'),
        'planner: ' + (data.jobSource || '-'),
        'paused: ' + s.runtime.paused,
        'sleeping: ' + s.circadian.sleeping,
        'day/time: ' + s.circadian.day + ' / ' + s.circadian.timeOfDay,
        'intentions: ' + ((s.goals.intentions || []).join(', ') || '-'),
        'userGoal: ' + (s.goals.userGoal || '-'),
        'following: ' + (s.runtime.following || '-'),
        'sleepRequested: ' + s.runtime.sleepRequested,
      ].join(BR) : '-'
      const learned = Object.entries(s?.skills || {}).map(([kind, entry]) => kind + ': ' + entry.rule + ' (day ' + entry.day + '; ' + entry.successes + ' worked, ' + entry.failures + ' failed)')
      const peers = (data.team?.peers || []).map(p => p.name + ': ' + p.activity)
      document.getElementById('learning').textContent = [...(learned.length ? learned : ['No skills learned yet.']),
        ...(data.team ? ['', 'Shared shelter · ' + data.team.id, ...(peers.length ? peers : ['No teammates reporting yet.'])] : [])].join(BR)
      const notes = (s?.journal?.notes || []).map(note => '• ' + note.text)
      document.getElementById('journal').textContent = notes.length ? ['Last review: day ' + s.journal.day, '', ...notes].join(BR) : 'No curated notes yet. A real sleep lets Ollama review the day.'

      document.getElementById('inventory').textContent = p ? (byCount(p.inventory.items).join(BR) || '(empty)') : '-'
      document.getElementById('safety').textContent = p ? [
        'dimension: ' + p.dimension,
        'position: ' + Math.floor(p.position.x) + ', ' + Math.floor(p.position.y) + ', ' + Math.floor(p.position.z),
        'hazard: ' + (p.hazard || '-'),
        'hostiles: ' + ((p.hostiles || []).slice(0, 8).map(function (h) { return h.name + '@' + Math.round(h.distance) }).join(', ') || '-'),
        'players: ' + ((p.players || []).slice(0, 8).map(function (h) { return h.name + '@' + Math.round(h.distance) }).join(', ') || '-'),
        'beds: ' + ((p.beds || []).length),
        'lastDamage: ' + (p.lastDamage ? (p.lastDamage.source + ' (' + Math.floor((Date.now() - p.lastDamage.at) / 1000) + 's ago)') : '-'),
      ].join(BR) : '-'

      document.getElementById('events').textContent = (data.events || []).map(function (e) {
        return 'day ' + e.day + ' · ' + (e.work ? e.work.kind + (e.work.success ? ' succeeded' : ' failed') + ' · ' + e.work.distance + ' blocks away' : e.kind + (e.tag ? (' (' + e.tag + ')') : ''))
      }).join(BR) || '-'
      document.getElementById('raw').textContent = JSON.stringify(data, null, 2)
    }
    async function connectNow() {
      const button = document.getElementById('connectNow')
      button.textContent = 'Connecting…'
      button.disabled = true
      try {
        const r = await fetch(connectUrl, { method: 'POST' })
        if (!r.ok) throw new Error(String(r.status))
      } catch (e) {
        console.error(e)
      } finally {
        setTimeout(function () { button.textContent = 'Connect now'; button.disabled = false }, 900)
      }
    }
    document.getElementById('connectNow').addEventListener('click', function () { void connectNow() })
    refresh(); setInterval(refresh, 1200)
    let mapTick = 0
    const mapUrl = apiUrl.replace('/api/state', '/api/map.png')
    function refreshMap() {
      const img = document.getElementById('map')
      if (img) img.src = mapUrl + '?t=' + Date.now()
    }
    refreshMap(); setInterval(refreshMap, 3600)
    document.getElementById('map').addEventListener('error', function () {
      document.getElementById('mapinfo').textContent = 'Map unavailable while bot is offline.'
    })
  </script>
</body>
</html>`
}

export function startMonitor(config: Config): MonitorSink | undefined {
  if (!config.MONITOR_ENABLED) return undefined
  const snapshot: Snapshot = {
    updatedAt: Date.now(), status: 'starting', username: null, reason: null,
    state: null, perception: null, activeAction: null, activeJob: null, jobSource: null, team: undefined, thoughts: null, events: [], notes: [],
  }
  const control: MonitorControl = {}
  let renderer: (() => string | undefined) | undefined
  let mapCache: { at: number; data?: string } = { at: 0 }
  const apply = (patch: MonitorPatch) => {
    if (patch.updatedAt !== undefined) snapshot.updatedAt = patch.updatedAt
    else snapshot.updatedAt = Date.now()
    if (patch.status) snapshot.status = patch.status
    if (patch.username !== undefined) snapshot.username = patch.username
    if (patch.reason !== undefined) snapshot.reason = patch.reason
    if (patch.state !== undefined) snapshot.state = structuredClone(patch.state)
    if (patch.perception !== undefined) snapshot.perception = structuredClone(patch.perception)
    if (patch.activeAction !== undefined) snapshot.activeAction = patch.activeAction
    if (patch.activeJob !== undefined) snapshot.activeJob = patch.activeJob
    if (patch.jobSource !== undefined) snapshot.jobSource = patch.jobSource
    if (patch.team) snapshot.team = structuredClone(patch.team)
    if (patch.thoughts !== undefined) snapshot.thoughts = structuredClone(patch.thoughts)
    if (patch.events !== undefined) snapshot.events = patch.events.slice(-30).map(e => ({ ...e }))
  }
  const note = (level: 'info' | 'warn' | 'error', message: string) => {
    snapshot.notes.push({ at: Date.now(), level, message: message.slice(0, 280) })
    if (snapshot.notes.length > 120) snapshot.notes = snapshot.notes.slice(-120)
  }

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const path = (req.url ?? '/').split('?')[0] ?? '/'
    if (path === '/health') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify({ ok: true, updatedAt: snapshot.updatedAt, status: snapshot.status }))
      return
    }
    if (path === '/api/state') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify(snapshot))
      return
    }
    if (path === '/api/notes') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify({ notes: snapshot.notes }))
      return
    }
    if (path === '/api/connect' && req.method === 'POST') {
      control.connect?.()
      note('info', 'Manual connect requested from dashboard')
      res.writeHead(202, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify({ ok: true }))
      return
    }
    if (path === '/api/map.png') {
      if (!renderer) {
        res.writeHead(503, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify({ ok: false, error: 'bot not connected' }))
        return
      }
      const now = Date.now()
      if (now - mapCache.at > 1600 || mapCache.data === undefined) {
        let data: string | undefined
        try { data = renderer() } catch { data = undefined }
        mapCache = { at: now, data }
      }
      if (!mapCache.data) {
        res.writeHead(503, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify({ ok: false, error: 'map render unavailable' }))
        return
      }
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' })
      res.end(Buffer.from(mapCache.data, 'base64'))
      return
    }
    if (path === '/' || path === '/index.html') {
      const url = `http://${config.MONITOR_HOST}:${config.MONITOR_PORT}`
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      res.end(html(url))
      return
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('Not found')
  })

  const host = config.MONITOR_HOST
  const port = config.MONITOR_PORT
  server.on('error', error => {
    const message = error instanceof Error ? error.message : String(error)
    note('error', `monitor server error: ${message}`)
    snapshot.status = 'disconnected'
    snapshot.reason = `monitor error: ${message}`
  })
  server.listen(port, host)
  const url = `http://${host}:${port}`

  return {
    url,
    setConnectHandler(handler) { control.connect = handler },
    setRenderer(fn) {
      renderer = fn
      mapCache = { at: 0 }
    },
    update: apply,
    note,
    async close() {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    },
  }
}
