import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { generateOtpCode, hashOtp, isOtpPurpose, normalizeOtpCode, OTP_LENGTH } from './otp.mjs'

describe('otp', () => {
  it('нормализует 4 цифры', () => {
    assert.equal(normalizeOtpCode('12 34'), '1234')
    assert.equal(normalizeOtpCode('12ab34'), '1234')
    assert.equal(OTP_LENGTH, 4)
    assert.equal(isOtpPurpose('reset'), true)
    assert.equal(isOtpPurpose('nope'), false)
  })

  it('код из четырёх цифр', () => {
    const code = generateOtpCode()
    assert.match(code, /^\d{4}$/)
  })

  it('хеш зависит от почты и назначения', () => {
    const a = hashOtp('A@B.c', 'reset', '0001')
    const b = hashOtp('a@b.c', 'reset', '0001')
    const c = hashOtp('a@b.c', 'login', '0001')
    assert.equal(a, b)
    assert.notEqual(b, c)
  })
})
