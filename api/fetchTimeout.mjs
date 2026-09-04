/**
 * У Node есть таймаут на установку соединения, но не на ответ: внешний сервис,
 * который принял запрос и замолчал, удерживал бы его бесконечно.
 */
export const DEFAULT_TIMEOUT_MS = 15_000

function hostOf(url) {
  try {
    return new URL(String(url)).host
  } catch {
    return 'внешний сервис'
  }
}

export class TimeoutError extends Error {
  constructor(url, timeoutMs) {
    super(`${hostOf(url)} не ответил за ${Math.round(timeoutMs / 1000)} с`)
    this.name = 'TimeoutError'
    this.timeoutMs = timeoutMs
  }
}

export async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: ctrl.signal })
  } catch (err) {
    if (err?.name === 'AbortError') throw new TimeoutError(url, timeoutMs)
    throw err
  } finally {
    clearTimeout(timer)
  }
}
