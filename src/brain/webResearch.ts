import { appendFileSync } from 'node:fs'
import type { Config } from '../config'

/**
 * Web research for the bot: DuckDuckGo HTML endpoint, no API key required.
 * Every query AND every answer snippet is logged to a local research journal so the
 * operator can audit exactly what the bot asked the internet and what it was told.
 */

export interface ResearchResult { query: string; results: Array<{ title: string; snippet: string; url: string }> }

const researchLogPath = (config: Config) => config.STATE_PATH.replace(/[^/]+$/, '') + 'research.log'

function logResearch(config: Config, entry: object) {
  try {
    appendFileSync(researchLogPath(config), `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`)
  } catch { /* research logging must never break the caller */ }
}

const blockTags = /<(?:script|style)[\s\S]*?<\/(?:script|style)>/gi
const decode: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#x27;': "'", '&#39;': "'", '&nbsp;': ' ' }
const strip = (html: string) => html.replace(blockTags, ' ').replace(/<[^>]+>/g, ' ')
  .replace(/&(?:amp|lt|gt|quot|#x27|#39|nbsp);/g, c => decode[c] ?? ' ')
  .replace(/\s+/g, ' ').trim()

export async function research(config: Config, rawQuery: string, signal: AbortSignal, limit = 3): Promise<ResearchResult> {
  // Defuse prompt-injection and abuse vectors at the boundary; never let raw chat drive URLs.
  const query = rawQuery.normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, 120)
  if (!query || /https?:\/\//i.test(query)) return { query, results: [] }
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
  const started = Date.now()
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) SoulBot research/1.0' },
      redirect: 'follow', signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const html = await res.text()
    const results: ResearchResult['results'] = []
    // DuckDuckGo HTML results: links with class result__a, snippets with result__snippet.
    const linkRe = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
    const snippetRe = /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi
    const snippets: string[] = []
    for (const match of html.matchAll(snippetRe)) snippets.push(strip(match[1] ?? ''))
    let index = 0
    for (const match of html.matchAll(linkRe)) {
      if (results.length >= limit) break
      const rawUrl = match[1] ?? ''
      // DuckDuckGo wraps target URLs in /l/?uddg=<encoded>
      const target = /uddg=([^&]+)/u.exec(rawUrl)?.[1]
      const href = target ? decodeURIComponent(target) : rawUrl
      if (!href.startsWith('http')) continue
      const title = strip(match[2] ?? '')
      if (!title) continue
      results.push({ title, snippet: snippets[index]?.slice(0, 220) ?? '', url: href.slice(0, 200) })
      index++
    }
    logResearch(config, { kind: 'research', query, ok: true, ms: Date.now() - started, count: results.length,
      results: results.map(r => ({ title: r.title, snippet: r.snippet, url: r.url })) })
    return { query, results }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logResearch(config, { kind: 'research', query, ok: false, ms: Date.now() - started, error: message })
    return { query, results: [] }
  }
}
