export function installShutdown(close: () => Promise<void>): void {
  let closing = false
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {
    if (closing) return
    closing = true
    void close().catch(error => { console.error('Shutdown failed:', error); process.exitCode = 1 })
  })
}
