export function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/\p{Cc}/gu, ' ').slice(0, 250)
}

export async function untilAbort<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason)
    const cleanup = () => signal.removeEventListener('abort', abort)
    pending.then(value => { cleanup(); resolve(value) }, err => { cleanup(); reject(err) })
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
  })
}
