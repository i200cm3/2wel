import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { decideGuestLink, parseGuestLinkBody, resolveTemplateCode } from './guestLink.mjs'

const published = { status: 'published', hasPublishedConfig: true }
const existing = {
  publicId: 'abc123xyz',
  url: '/abc123xyz',
  guestName: 'Иван',
  externalId: 'crm-123',
  templateCode: 'default',
}

describe('parseGuestLinkBody', () => {
  it('читает name, category и externalId / external_id', () => {
    assert.deepEqual(
      parseGuestLinkBody({ name: ' Иван ', category: 'single', externalId: ' crm-1 ' }),
      {
        name: 'Иван',
        category: 'single',
        externalId: 'crm-1',
        statusId: '',
        summary: { dates: '', partyType: '', topics: '', objections: '', confidence: '0.8', room: '', fillRemaining: 'off' },
        amoSnapshot: null,
        summaryMeta: null,
        rawSources: [],
      },
    )
    assert.equal(parseGuestLinkBody({ name: 'Анна', external_id: 'ext' }).externalId, 'ext')
    assert.equal(parseGuestLinkBody({ name: 'Анна', externalId: 12345 }).externalId, '12345')
    assert.equal(parseGuestLinkBody({}).name, '')
  })

  it('читает statusId', () => {
    assert.equal(parseGuestLinkBody({ name: 'Анна', status_id: 142 }).statusId, '142')
    assert.equal(parseGuestLinkBody({ name: 'Анна', statusId: '99' }).statusId, '99')
  })

  it('делает первую букву имени заглавной', () => {
    assert.equal(parseGuestLinkBody({ name: 'виталий' }).name, 'Виталий')
    assert.equal(parseGuestLinkBody({ name: 'АННА' }).name, 'АННА')
    assert.equal(parseGuestLinkBody({ name: '  мария ' }).name, 'Мария')
  })

  it('читает summary из body и summary-объекта', () => {
    assert.deepEqual(parseGuestLinkBody({
      name: 'Иван',
      topics: 'room, food',
      party_type: 'couple',
      confidence: '0.6',
    }).summary, {
      dates: '',
      partyType: 'couple',
      topics: 'room, food',
      objections: '',
      confidence: '0.6',
      room: '',
      fillRemaining: 'off',
    })
    assert.equal(parseGuestLinkBody({ name: 'Иван', summary: { dates: '12-15 мая' } }).summary.dates, '12-15 мая')
    assert.equal(
      parseGuestLinkBody({ name: 'Иван', fillRemaining: 'soft' }).summary.fillRemaining,
      'soft',
    )
  })
  it('читает rawText / amoSnapshot / summaryMeta', () => {
    const parsed = parseGuestLinkBody({
      name: 'Иван',
      rawText: 'клиент спросил про номер',
      amoSnapshot: { statusId: '142' },
      summaryMeta: { source: 'manual' },
      rawSources: [{ kind: 'chat', body: 'привет' }],
    })
    assert.deepEqual(parsed.amoSnapshot, { statusId: '142' })
    assert.deepEqual(parsed.summaryMeta, { source: 'manual' })
    assert.equal(parsed.rawSources.length, 2)
    assert.equal(parsed.rawSources[0].body, 'привет')
    assert.equal(parsed.rawSources[1].kind, 'manual')
    assert.equal(parsed.rawSources[1].body, 'клиент спросил про номер')
  })
})

describe('resolveTemplateCode', () => {
  const map = [
    { statusId: '142', templateCode: 'checkin' },
    { statusId: '143', templateCode: 'double' },
  ]

  it('явный category важнее карты', () => {
    assert.equal(
      resolveTemplateCode({ category: 'single', statusId: '142', statusMap: map }),
      'single',
    )
  })

  it('берёт шаблон из карты по statusId', () => {
    assert.equal(resolveTemplateCode({ category: '', statusId: '142', statusMap: map }), 'checkin')
    assert.equal(resolveTemplateCode({ category: '', statusId: '999', statusMap: map }), '')
  })
})

describe('decideGuestLink · POST /api/v1/projects/:code/links', () => {
  it('отклоняет пустое имя', () => {
    const out = decideGuestLink({ name: '', externalId: '', existing: null, template: published })
    assert.equal(out.ok, false)
    assert.equal(out.status, 400)
  })

  it('повтор с тем же externalId возвращает ту же ссылку и не смотрит на шаблон', () => {
    const out = decideGuestLink({
      name: 'Иван',
      externalId: 'crm-123',
      existing,
      template: null,
    })
    assert.equal(out.ok, true)
    assert.equal(out.reused, true)
    assert.equal(out.link.publicId, 'abc123xyz')
  })

  it('без externalId создаёт новую, если шаблон опубликован', () => {
    const out = decideGuestLink({
      name: 'Иван',
      externalId: '',
      existing: null,
      template: published,
    })
    assert.equal(out.ok, true)
    assert.equal(out.reused, false)
  })

  it('не выдаёт ссылку на неопубликованный шаблон', () => {
    const out = decideGuestLink({
      name: 'Иван',
      externalId: 'new-id',
      existing: null,
      template: { status: 'draft', hasPublishedConfig: true },
    })
    assert.equal(out.ok, false)
    assert.match(out.error, /опубликован/)
  })

  it('не выдаёт ссылку, если в эфире нет конфига', () => {
    const out = decideGuestLink({
      name: 'Иван',
      externalId: '',
      existing: null,
      template: { status: 'published', hasPublishedConfig: false },
    })
    assert.equal(out.ok, false)
  })

  it('неизвестный category', () => {
    const out = decideGuestLink({
      name: 'Иван',
      externalId: '',
      existing: null,
      template: null,
    })
    assert.equal(out.status, 400)
    assert.match(out.error, /шаблон/)
  })
})
