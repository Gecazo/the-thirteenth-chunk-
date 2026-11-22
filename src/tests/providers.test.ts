import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer, type RequestListener } from 'node:http'
import { once } from 'node:events'
import { parseConfig } from '../config'
import { ollamaClient } from '../llm/localOllamaClient'
import { requestJson } from '../llm/providerRouter'

async function withServer(handler: RequestListener, run: (base: string) => Promise<void>) {
  const server = createServer(handler)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Unexpected HTTP listener address')
    await run(`http://127.0.0.1:${address.port}`)
  } finally {
    const closed = once(server, 'close')
    server.close()
    server.closeAllConnections()
    await closed
  }
}

test('Ollama adapter handles HTTP endpoint and parses the response envelope', async () => {
  const requests: { method: string | undefined; url: string | undefined; body: unknown }[] = []
  await withServer((req, res) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, body: JSON.parse(body) as unknown })
      res.end(JSON.stringify({ message: { content: '{"reply":"Hello."}' } }))
    })
  }, async base => {
    const provider = ollamaClient(parseConfig({ OLLAMA_BASE_URL: base, OLLAMA_MODEL: 'fixture' }))
    const result = await provider.propose({ system: 'Instructions.', user: 'Untrusted chat.' }, new AbortController().signal)
    assert.deepEqual(result, { reply: 'Hello.' })
  })
  assert.equal(requests[0]?.method, 'POST')
  assert.equal(requests[0]?.url, '/api/chat')
  assert.deepEqual((requests[0]?.body as { messages: unknown }).messages, [{ role: 'system', content: 'Instructions.' }, { role: 'user', content: 'Untrusted chat.' }])
})

test('Ollama chat attaches vision only to the user message, with a bounded choice schema and context', async () => {
  const image = Buffer.from('fixture-image').toString('base64')
  const format = { type: 'object', required: ['choice'], properties: { choice: { type: 'integer', maximum: 1 } } }
  let request: unknown
  await withServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    request = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
    res.end(JSON.stringify({ message: { content: '{"choice":1}' } }))
  }, async base => {
    const provider = ollamaClient(parseConfig({ OLLAMA_BASE_URL: base }))
    assert.deepEqual(await provider.propose({ system: 'Pick one.', user: 'Two jobs.', image, format, tokenBudget: 32 }, new AbortController().signal), { choice: 1 })
  })
  assert.deepEqual(request, {
    model: 'qwen3.5:4b', stream: false, think: false, keep_alive: '5m', format,
    options: { temperature: .2, num_predict: 32, num_ctx: 4096 },
    messages: [{ role: 'system', content: 'Pick one.' }, { role: 'user', content: 'Two jobs.', images: [image] }],
  })
})

test('HTTP adapter retries transient failures once, refuses redirects and bounds response size', async () => {
  let transient = 0, escaped = 0
  await withServer((req, res) => {
    switch (req.url) {
      case '/retry': res.statusCode = ++transient === 1 ? 503 : 200; res.end('{}'); break
      case '/redirect': res.writeHead(307, { location: '/other' }); res.end(); break
      case '/large': res.end('x'.repeat(65 * 1024)); break
      default: escaped++; res.end('{}')
    }
  }, async base => {
    const request = (path: string, retry = false) => requestJson(`${base}${path}`, {}, {}, 2500, new AbortController().signal, retry)
    assert.deepEqual(await request('/retry', true), {})
    assert.equal(transient, 2)
    await assert.rejects(request('/redirect'))
    assert.equal(escaped, 0)
    await assert.rejects(request('/large'), /size limit/)
  })
})
