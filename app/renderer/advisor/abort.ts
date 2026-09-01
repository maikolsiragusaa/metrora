/**
 * Owns the foreground lifecycle even if an IPC/provider promise ignores the
 * AbortSignal. Late settlements are consumed and cannot update the caller.
 */
export type AdvisorTurnDeadline = {
  signal: AbortSignal
  didTimeout: () => boolean
  dispose: () => void
}

/**
 * Creates the single deadline for one foreground Chat turn. Parent
 * cancellation is forwarded, while a deadline abort is kept distinguishable
 * so the runtime can return truthful evidence instead of surfacing a raw
 * timeout as a cancellation.
 */
export function createAdvisorTurnDeadline(parent: AbortSignal | undefined, timeoutMs: number): AdvisorTurnDeadline {
  const controller = new AbortController()
  let timedOut = false
  const forwardAbort = () => controller.abort()
  if (parent?.aborted) controller.abort()
  else parent?.addEventListener('abort', forwardAbort, { once: true })
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    dispose: () => {
      clearTimeout(timer)
      parent?.removeEventListener('abort', forwardAbort)
    },
  }
}

export function isAdvisorAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || /cancel|abort/i.test(error.message))
}

/** Parent cancellation remains a cancellation; the local deadline is a safe fallback path. */
export function shouldRethrowAdvisorAbort(error: unknown, parent: AbortSignal | undefined, deadline: AdvisorTurnDeadline): boolean {
  return Boolean(parent?.aborted) || (!deadline.didTimeout() && isAdvisorAbortError(error))
}

export function raceAdvisorAbort<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation
  if (signal.aborted) {
    void operation.then(() => undefined, () => undefined)
    return Promise.reject(new DOMException('Advisor request cancelled', 'AbortError'))
  }
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    const onAbort = () => {
      if (settled) return
      settled = true
      cleanup()
      reject(new DOMException('Advisor request cancelled', 'AbortError'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    operation.then(value => {
      if (settled) return
      settled = true
      cleanup()
      resolve(value)
    }, error => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    })
  })
}
