/**
 * A renderer-side request must be cancellable even when the underlying IPC
 * promise does not settle after its AbortSignal is triggered. The transport
 * still receives the signal and its explicit cancel hook, but this race owns
 * the foreground lifecycle.
 */
export function raceAdvisorAbort<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation
  if (signal.aborted) {
    // The operation has already been started by the caller. Consume a late
    // rejection even though the caller no longer needs its value.
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
