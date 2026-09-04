import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  guestFirstNameFromContact,
  leadSnapshotFromAmo,
  normalizeAmoDomain,
  pickPresentationLinkField,
  signAmoState,
  verifyAmoState,
} from './amoAuth.mjs'

describe('normalizeAmoDomain', () => {
  it('принимает поддомен amo', () => {
    assert.equal(normalizeAmoDomain('https://djinal.amocrm.ru/'), 'djinal.amocrm.ru')
    assert.equal(normalizeAmoDomain('sanplaza.kommo.com'), 'sanplaza.kommo.com')
  })

  it('отклоняет чужой хост', () => {
    assert.equal(normalizeAmoDomain('evil.example.com'), '')
    assert.equal(normalizeAmoDomain(''), '')
  })
})

describe('amo OAuth state', () => {
  it('подписывает и читает projectId', () => {
    process.env.AUTH_SECRET = 'unit-test-auth-secret-value-24'
    const state = signAmoState('11111111-1111-4111-8111-111111111111')
    const out = verifyAmoState(state)
    assert.equal(out.ok, true)
    assert.equal(out.projectId, '11111111-1111-4111-8111-111111111111')
  })

  it('отклоняет подделку и просрочку', () => {
    process.env.AUTH_SECRET = 'unit-test-auth-secret-value-24'
    assert.equal(verifyAmoState('abc.def').ok, false)
    const state = signAmoState('11111111-1111-4111-8111-111111111111', Date.now() - 21 * 60 * 1000)
    assert.equal(verifyAmoState(state).ok, false)
  })
})

describe('pickPresentationLinkField', () => {
  it('находит поле по имени и предпочитает тип url', () => {
    const field = pickPresentationLinkField([
      { id: 1, name: 'Комментарий', type: 'text' },
      { id: 2, name: 'Ссылка для презентации', type: 'text' },
      { id: 3, name: 'ссылка для презентации', type: 'url' },
    ])
    assert.equal(field.id, 3)
  })

  it('без поля возвращает null', () => {
    assert.equal(pickPresentationLinkField([{ id: 1, name: 'Телефон', type: 'text' }]), null)
  })
})

describe('guestFirstNameFromContact', () => {
  it('берёт first_name, иначе первое слово name', () => {
    assert.equal(guestFirstNameFromContact({ first_name: 'Александр', name: 'Александр Иванов' }), 'Александр')
    assert.equal(guestFirstNameFromContact({ name: 'Мария Петрова' }), 'Мария')
    assert.equal(guestFirstNameFromContact({}), '')
  })
})

describe('leadSnapshotFromAmo', () => {
  it('забирает имя контакта и status/pipeline сделки', () => {
    assert.deepEqual(
      leadSnapshotFromAmo(
        { status_id: 142, pipeline_id: 771 },
        { first_name: 'Иван', name: 'Иван Петров' },
      ),
      { name: 'Иван', statusId: '142', pipelineId: '771', contactId: '', phones: [] },
    )
  })

  it('без контакта и статуса — пустые строки', () => {
    assert.deepEqual(leadSnapshotFromAmo({}, null), {
      name: '',
      statusId: '',
      pipelineId: '',
      contactId: '',
      phones: [],
    })
  })
})
