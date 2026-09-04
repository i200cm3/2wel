import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { guestBaseDomain, guestLinkUrl } from './publicUrl.mjs'

describe('guestLinkUrl', () => {
  it('собирает поддомен проекта', () => {
    process.env.GUEST_BASE_DOMAIN = '2wel.ru'
    assert.equal(guestLinkUrl('djinal', 'k7m2n9q'), 'https://djinal.2wel.ru/k7m2n9q')
    assert.equal(guestLinkUrl('djinal', '/Abc123xyz'), 'https://djinal.2wel.ru/abc123xyz')
  })

  it('без кода проекта не выдумывает поддомен', () => {
    process.env.GUEST_BASE_DOMAIN = '2wel.ru'
    assert.equal(guestLinkUrl('', 'abc123'), 'https://2wel.ru/abc123')
  })
})

describe('guestBaseDomain', () => {
  it('берёт GUEST_BASE_DOMAIN', () => {
    process.env.GUEST_BASE_DOMAIN = 'https://2wel.ru/'
    assert.equal(guestBaseDomain(), '2wel.ru')
  })
})
