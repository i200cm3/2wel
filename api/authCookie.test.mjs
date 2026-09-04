import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  cookieToken,
  isWeakAuthSecret,
  requestIsHttps,
  requestSessionToken,
  setSessionCookie,
  clearSessionCookie,
} from './auth.js'

describe('cookieToken', () => {
  it('читает promo_session из Cookie', () => {
    const req = { headers: { cookie: 'foo=1; promo_session=abc%2Edef; bar=2' } }
    assert.equal(cookieToken(req), 'abc.def')
  })

  it('пустой заголовок даёт пустую строку', () => {
    assert.equal(cookieToken({ headers: {} }), '')
  })
})

describe('requestSessionToken', () => {
  it('берёт Bearer, если он есть', () => {
    const req = {
      headers: { authorization: 'Bearer tok', cookie: 'promo_session=from-cookie' },
    }
    assert.equal(requestSessionToken(req), 'tok')
  })

  it('иначе берёт cookie', () => {
    const req = { headers: { cookie: 'promo_session=from-cookie' } }
    assert.equal(requestSessionToken(req), 'from-cookie')
  })
})

describe('isWeakAuthSecret', () => {
  it('отклоняет короткий и известный слабый секрет', () => {
    assert.equal(isWeakAuthSecret('changeme'), true)
    assert.equal(isWeakAuthSecret('change-me-to-a-long-random-string'), true)
    assert.equal(isWeakAuthSecret('secret'), true)
    assert.equal(isWeakAuthSecret('a'.repeat(23)), true)
  })

  it('принимает длинный нестандартный секрет', () => {
    assert.equal(isWeakAuthSecret('a'.repeat(24)), false)
    assert.equal(isWeakAuthSecret('promo-local-dev-secret-ok'), false)
  })
})

describe('session cookie', () => {
  it('ставит HttpOnly SameSite=Lax и Secure на HTTPS', () => {
    const headers = {}
    const res = { setHeader(name, value) { headers[name] = value } }
    setSessionCookie(res, 'tok.en', { remember: false, secure: true })
    const cookie = String(headers['Set-Cookie'])
    assert.match(cookie, /^promo_session=tok\.en;/)
    assert.match(cookie, /HttpOnly/)
    assert.match(cookie, /SameSite=Lax/)
    assert.match(cookie, /Secure/)
    assert.match(cookie, /Path=\//)
  })

  it('очищает cookie', () => {
    const headers = {}
    const res = { setHeader(name, value) { headers[name] = value } }
    clearSessionCookie(res, { secure: false })
    const cookie = String(headers['Set-Cookie'])
    assert.match(cookie, /promo_session=;/)
    assert.match(cookie, /Max-Age=0/)
    assert.doesNotMatch(cookie, /Secure/)
  })
})

describe('requestIsHttps', () => {
  it('смотрит X-Forwarded-Proto', () => {
    assert.equal(requestIsHttps({ headers: { 'x-forwarded-proto': 'https' } }), true)
    assert.equal(requestIsHttps({ headers: { 'x-forwarded-proto': 'http' } }), false)
  })
})
