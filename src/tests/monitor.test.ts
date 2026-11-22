import assert from 'node:assert/strict'
import test from 'node:test'
import { parseConfig } from '../config'
import { startMonitor } from '../monitor/server'
import { Script } from 'node:vm'

test('monitor serves live snapshot data', async () => {
  const monitor = startMonitor(parseConfig({ MONITOR_ENABLED: 'true', MONITOR_HOST: '127.0.0.1', MONITOR_PORT: '8879' }))
  assert.ok(monitor)
  try {
    let requested = 0
    monitor.setConnectHandler(() => { requested++ })
    monitor.update({ status: 'connected', username: 'SoulBot', updatedAt: Date.now(), events: [] })
    const res = await fetch('http://127.0.0.1:8879/api/state')
    assert.equal(res.ok, true)
    const json = await res.json() as { status: string; username: string }
    assert.equal(json.status, 'connected')
    assert.equal(json.username, 'SoulBot')
    const connect = await fetch('http://127.0.0.1:8879/api/connect', { method: 'POST' })
    assert.equal(connect.status, 202)
    assert.equal(requested, 1)
    const mapMissing = await fetch('http://127.0.0.1:8879/api/map.png')
    assert.equal(mapMissing.status, 503)
    const html = await (await fetch('http://127.0.0.1:8879/')).text()
    assert.match(html, /SoulBot Monitor/)
    assert.match(html, /Connect now/)
    assert.match(html, /Map \(top-down\)/)
    assert.match(html, /Curated journal/)
    assert.doesNotThrow(() => new Script(html.match(/<script>([\s\S]*?)<\/script>/u)![1]!))
  } finally {
    await monitor?.close()
  }
})
