import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { authEnv } from './auth.mjs'
import { guestHostname, parseSanNames, guestSslRequestAuthorized } from './guestSsl.mjs'

describe('parseSanNames', () => {
  it('достаёт DNS из openssl', () => {
    const text = `X509v3 Subject Alternative Name:\n    DNS:2wel.ru, DNS:djinal.2wel.ru`
    assert.deepEqual(parseSanNames(text), ['2wel.ru', 'djinal.2wel.ru'])
  })
})

describe('guestHostname', () => {
  it('собирает поддомен проекта', () => {
    process.env.GUEST_BASE_DOMAIN = '2wel.ru'
    assert.equal(guestHostname('djinal'), 'djinal.2wel.ru')
  })
})

describe('guestSslRequestAuthorized', () => {
  it('без Bearer отклоняет', () => {
    assert.equal(guestSslRequestAuthorized({ headers: {} }), false)
  })

  it('принимает AUTH_SECRET и отклоняет чужой токен', () => {
    const expected = authEnv().secret
    if (!expected) return
    assert.equal(
      guestSslRequestAuthorized({ headers: { authorization: `Bearer ${expected}` } }),
      true,
    )
    assert.equal(
      guestSslRequestAuthorized({ headers: { authorization: 'Bearer not-the-secret' } }),
      false,
    )
  })
})
