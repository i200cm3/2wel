import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  amoPhoneQueryVariants,
  normalizeAmoPhone,
  phonesFromAmoContact,
  phonesFromAmoNoteParams,
  uniqueAmoPhones,
} from './amoPhone.mjs'

describe('normalizeAmoPhone', () => {
  it('приводит 8, +7 и 10 цифр к 7XXXXXXXXXX', () => {
    assert.equal(normalizeAmoPhone('+7 (900) 123-45-67'), '79001234567')
    assert.equal(normalizeAmoPhone('8 900 123 45 67'), '79001234567')
    assert.equal(normalizeAmoPhone('9001234567'), '79001234567')
    assert.equal(normalizeAmoPhone('79001234567'), '79001234567')
  })

  it('пустые и короткие отбрасывает', () => {
    assert.equal(normalizeAmoPhone(''), '')
    assert.equal(normalizeAmoPhone('12345'), '')
  })
})

describe('uniqueAmoPhones / variants', () => {
  it('убирает дубли после нормализации', () => {
    assert.deepEqual(uniqueAmoPhones(['89001234567', '+7 900 123-45-67']), ['79001234567'])
  })

  it('даёт варианты для поиска amo', () => {
    const variants = amoPhoneQueryVariants('79001234567')
    assert.ok(variants.includes('79001234567'))
    assert.ok(variants.includes('89001234567'))
    assert.ok(variants.includes('9001234567'))
  })
})

describe('phonesFromAmoContact', () => {
  it('берёт PHONE из custom_fields_values', () => {
    assert.deepEqual(
      phonesFromAmoContact({
        custom_fields_values: [
          { field_code: 'EMAIL', values: [{ value: 'a@b.c' }] },
          { field_code: 'PHONE', values: [{ value: '+79001234567' }, { value: '89001112233' }] },
        ],
      }),
      ['79001234567', '79001112233'],
    )
  })
})

describe('phonesFromAmoNoteParams', () => {
  it('берёт params.phone и номер из текста', () => {
    assert.deepEqual(phonesFromAmoNoteParams({ phone: '89001234567' }, ''), ['79001234567'])
    assert.deepEqual(
      phonesFromAmoNoteParams({}, 'Входящий +7 900 123-45-67'),
      ['79001234567'],
    )
  })
})
