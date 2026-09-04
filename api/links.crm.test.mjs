import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { crmStatusChanged, crmStatusContextFromEvents } from './links.mjs'

describe('crmStatusChanged', () => {
  it('пишет только при новом непустом статусе', () => {
    assert.equal(crmStatusChanged(null, '142'), true)
    assert.equal(crmStatusChanged('', '142'), true)
    assert.equal(crmStatusChanged('142', '143'), true)
    assert.equal(crmStatusChanged('142', '142'), false)
    assert.equal(crmStatusChanged('142', ''), false)
    assert.equal(crmStatusChanged(null, null), false)
  })
})

describe('crmStatusContextFromEvents', () => {
  it('берёт последнее действие и набор prior в порядке воронки', () => {
    const at = new Date('2026-08-26T10:00:00Z')
    assert.deepEqual(
      crmStatusContextFromEvents([
        { type: 'whatsapp', created_at: at },
        { type: 'menu', created_at: new Date('2026-08-26T09:59:00Z') },
        { type: 'open', created_at: new Date('2026-08-26T09:50:00Z') },
      ]),
      {
        lastEventType: 'whatsapp',
        lastEventAt: at,
        priorTypes: ['open', 'menu', 'whatsapp'],
      },
    )
  })

  it('без событий — пустой контекст', () => {
    assert.deepEqual(crmStatusContextFromEvents([]), {
      lastEventType: null,
      lastEventAt: null,
      priorTypes: [],
    })
  })
})
