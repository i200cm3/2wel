import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { amoTokenFrom } from './v1.mjs'

describe('amoTokenFrom', () => {
  it('читает токен из /api/v1/amocrm/webhook/pk_live_…', () => {
    const token = 'pk_live_0123456789abcdef0123456789abcdef0123456789abcdef'
    const out = amoTokenFrom(`/api/v1/amocrm/webhook/${token}`, { url: '/' })
    assert.deepEqual(out, { hit: true, token })
  })

  it('читает токен из Salesbot-пути без /webhook/', () => {
    const token = 'pk_live_0123456789abcdef0123456789abcdef0123456789abcdef'
    const out = amoTokenFrom(`/api/v1/amocrm/${token}`, { url: '/' })
    assert.deepEqual(out, { hit: true, token })
  })

  it('не матчит чужой /api/v1/ путь', () => {
    const out = amoTokenFrom('/api/v1/projects/djinal/links', { url: '/' })
    assert.deepEqual(out, { hit: false, token: '' })
  })
})
