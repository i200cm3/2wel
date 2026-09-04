import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { fetchWithTimeout, TimeoutError } from './fetchTimeout.mjs'

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('fetchWithTimeout', () => {
  it('обрывает молчащий сервис и называет хост', async () => {
    globalThis.fetch = (_url, options) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        })
      })

    await assert.rejects(
      () => fetchWithTimeout('https://api.elevenlabs.io/v1/x', {}, 20),
      (err) => {
        assert.ok(err instanceof TimeoutError)
        assert.match(err.message, /api\.elevenlabs\.io/)
        return true
      },
    )
  })

  it('снимает таймер после успешного ответа', async () => {
    let received
    globalThis.fetch = (_url, options) => {
      received = options
      return Promise.resolve({ ok: true, status: 200 })
    }

    const res = await fetchWithTimeout('https://example.test/ok', { method: 'POST' }, 50)
    assert.equal(res.status, 200)
    assert.equal(received.method, 'POST')
    assert.equal(received.signal.aborted, false)

    await new Promise((resolve) => setTimeout(resolve, 80))
    assert.equal(received.signal.aborted, false, 'таймер должен быть снят, а не сработать позже')
  })

  it('не подменяет обычные сетевые ошибки', async () => {
    globalThis.fetch = () => Promise.reject(new Error('ECONNREFUSED'))
    await assert.rejects(
      () => fetchWithTimeout('https://example.test/down', {}, 50),
      /ECONNREFUSED/,
    )
  })
})
