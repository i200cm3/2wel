import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { AMO_WEBHOOK_SETTINGS } from './amoAuth.mjs'
import {
  amoNoteRef,
  entityIdsFromAmoNotes,
  inspectCallNoteFromAmo,
  isAmoCallSourceRef,
  leadIdsFromAmoLinks,
  leadIdsFromEmbeddedLeads,
  recordingProbeAvailability,
  noteCreatedAtMs,
  parseCallNoteFromAmo,
  recordingContentLooksValid,
  recordingContentTypeLooksValid,
} from './amoCalls.mjs'

describe('parseCallNoteFromAmo', () => {
  it('парсит входящий звонок Sipuni', () => {
    const out = parseCallNoteFromAmo({
      id: 501,
      note_type: 'call_in',
      created_at: 1_700_000_000,
      params: {
        phone: '+79001234567',
        duration: 125,
        link: 'https://sipuni.com/api/crm/record?id=abc&hash=xyz',
      },
    })
    assert.ok(out)
    assert.equal(out.externalRef, 'amo:note:501')
    assert.equal(out.body, 'https://sipuni.com/api/crm/record?id=abc&hash=xyz')
    assert.match(out.title, /Входящий/)
    assert.match(out.title, /2:05/)
    assert.equal(out.capturedAt, new Date(1_700_000_000 * 1000).toISOString())
  })

  it('игнорирует примечание без записи', () => {
    assert.equal(parseCallNoteFromAmo({ id: 1, note_type: 'common', params: {} }), null)
    assert.equal(parseCallNoteFromAmo({ id: 2, note_type: 'call_out', params: {} }), null)
    assert.deepEqual(inspectCallNoteFromAmo({ id: 2, note_type: 'call_out', params: {} }).reason, 'no_recording_url')
    assert.equal(inspectCallNoteFromAmo({ id: 1, note_type: 'common', params: {} }).reason, 'not_call')
  })

  it('парсит исходящий звонок', () => {
    const out = parseCallNoteFromAmo({
      id: 77,
      note_type: 'call_out',
      params: { link: 'https://sipuni.com/api/crm/record?id=1' },
    })
    assert.ok(out)
    assert.match(out.title, /Исходящий/)
    assert.equal(out.externalRef, 'amo:note:77')
  })

  it('парсит params-json и sipuni-ссылку в значении', () => {
    const out = parseCallNoteFromAmo({
      id: 88,
      note_type: 'call_in',
      params: JSON.stringify({
        link: 'https://sipuni.com/api/crm/record?id=abc',
      }),
    })
    assert.ok(out)
    assert.equal(out.body, 'https://sipuni.com/api/crm/record?id=abc')
  })

  it('парсит ссылку из текста примечания', () => {
    const out = parseCallNoteFromAmo({
      id: 89,
      note_type: 'call_out',
      text: 'Запись: https://sipuni.com/api/crm/record?id=xyz&hash=1',
      params: { duration: 40, phone: '+7999' },
    })
    assert.ok(out)
    assert.match(out.body, /sipuni\.com\/api\/crm\/record/)
  })

  it('берёт любой https из текста call-заметки', () => {
    const out = parseCallNoteFromAmo({
      id: 90,
      note_type: 'call_in',
      text: 'https://cdn.example.com/audio/123.mp3',
      params: {},
    })
    assert.ok(out)
    assert.equal(out.body, 'https://cdn.example.com/audio/123.mp3')
  })
})

describe('note timestamps', () => {
  it('читает created_at в секундах и миллисекундах', () => {
    assert.equal(noteCreatedAtMs({ created_at: 1_700_000_000 }), 1_700_000_000_000)
    assert.equal(noteCreatedAtMs({ created_at: 1_700_000_000_000 }), 1_700_000_000_000)
  })
})

describe('amo note refs', () => {
  it('строит и распознаёт префикс', () => {
    assert.equal(amoNoteRef(42), 'amo:note:42')
    assert.equal(isAmoCallSourceRef('amo:note:42'), true)
    assert.equal(isAmoCallSourceRef('https://sipuni.com/x'), false)
  })
})

describe('recording probe heuristics', () => {
  it('отклоняет sipuni User is not licensed', () => {
    assert.equal(recordingContentTypeLooksValid('text/html; charset=UTF-8'), false)
    assert.equal(
      recordingContentLooksValid('text/html; charset=UTF-8', 'User is not licensed'),
      false,
    )
  })

  it('не считает любое слово error признаком недоступности', () => {
    assert.equal(recordingContentLooksValid('audio/mpeg', 'prefix error suffix'), true)
  })

  it('принимает audio content-type', () => {
    assert.equal(recordingContentTypeLooksValid('audio/mpeg'), true)
    assert.equal(recordingContentLooksValid('audio/mpeg', ''), true)
  })

  it('различает окончательную и временную недоступность', () => {
    assert.equal(recordingProbeAvailability({ ok: false, reason: 'sipuni-not-licensed' }), 'unavailable')
    assert.equal(recordingProbeAvailability({ ok: false, reason: 'not-a-recording' }), 'unavailable')
    assert.equal(recordingProbeAvailability({ ok: false, reason: 'timeout' }), 'unavailable')
    assert.equal(recordingProbeAvailability({ ok: false, reason: 'network-error' }), null)
    assert.equal(recordingProbeAvailability({ ok: true }), 'available')
  })
})

describe('AMO_WEBHOOK_SETTINGS', () => {
  it('подписывается на note_lead и note_contact', () => {
    assert.deepEqual(AMO_WEBHOOK_SETTINGS, ['note_lead', 'note_contact', 'status_lead'])
  })
})

describe('entityIdsFromAmoNotes', () => {
  it('берёт сделку и контакт из note amo API', () => {
    assert.deepEqual(
      entityIdsFromAmoNotes([
        { id: 1, entity_type: 'leads', entity_id: 111 },
        { id: 2, entity_type: 'contacts', entity_id: 222 },
        { id: 3, entity_type: '1', entity_id: 333 },
      ]),
      { leadIds: ['111'], contactIds: ['222', '333'] },
    )
  })
})

describe('leadIdsFromAmoLinks', () => {
  it('читает to_entity_type leads и число 2', () => {
    assert.deepEqual(
      leadIdsFromAmoLinks({
        _embedded: {
          links: [
            { to_entity_type: 'leads', to_entity_id: 100 },
            { to_entity_type: 2, to_entity_id: 200 },
            { entity_type: 'lead', entity_id: 300 },
            { to_entity_type: 'contacts', to_entity_id: 9 },
          ],
        },
      }),
      ['100', '200', '300'],
    )
  })
})

describe('leadIdsFromEmbeddedLeads', () => {
  it('берёт id из _embedded.leads', () => {
    assert.deepEqual(
      leadIdsFromEmbeddedLeads({ _embedded: { leads: [{ id: 11 }, { id: '22' }] } }),
      ['11', '22'],
    )
  })
})
