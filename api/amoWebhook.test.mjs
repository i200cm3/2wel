import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  decodeJwtPayload,
  extractAmoGuestLink,
  extractAmoNoteEvents,
  extractContactIdsFromNoteWebhook,
  extractLeadIdsFromNoteWebhook,
  extractPhonesFromAmoWebhook,
  hasLeadStatusWebhook,
  isCallLikeNoteType,
  isNoteLeadWebhook,
  parseNestedForm,
  parseV1Body,
  shouldIssueGuestLinkFromAmoWebhook,
  shouldIssueAfterPipelineCheck,
  isPipelineAllowedForIssue,
  shouldRetryAmoCallSync,
  shouldSyncCallsFromNoteEvents,
  summarizeAmoWebhookBody,
} from './amoWebhook.mjs'

function jwtWith(payload) {
  const json = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `eyJhbGciOiJub25lIn0.${json}.x`
}

describe('parseNestedForm', () => {
  it('собирает leads[status][0][id]', () => {
    const body = parseNestedForm('leads[status][0][id]=99&leads[status][0][name]=Иван+Петров')
    assert.equal(body.leads.status[0].id, '99')
    assert.equal(body.leads.status[0].name, 'Иван Петров')
  })
})

describe('parseV1Body', () => {
  it('читает JSON', () => {
    assert.deepEqual(parseV1Body('{"name":"Анна"}', 'application/json'), {
      ok: true,
      body: { name: 'Анна' },
    })
  })

  it('читает form-urlencoded', () => {
    const out = parseV1Body('name=Анна&leads[add][0][id]=1', 'application/x-www-form-urlencoded')
    assert.equal(out.ok, true)
    assert.equal(out.body.name, 'Анна')
    assert.equal(out.body.leads.add[0].id, '1')
  })

  it('пустое тело — объект', () => {
    assert.deepEqual(parseV1Body('', ''), { ok: true, body: {} })
  })
})

describe('extractAmoGuestLink', () => {
  it('берёт name и lead.id из data Salesbot', () => {
    assert.deepEqual(
      extractAmoGuestLink({
        data: { name: ' Александр ', 'lead.id': '555', category: 'double' },
      }),
      { name: 'Александр', category: 'double', externalId: '555', statusId: '', pipelineId: '' },
    )
  })

  it('contact строкой, id числом', () => {
    const out = extractAmoGuestLink({
      data: { contact: 'Мария Иванова', lead_id: 12 },
    })
    assert.equal(out.name, 'Мария')
    assert.equal(out.externalId, '12')
  })

  it('классический webhook сделки + контакт', () => {
    const out = extractAmoGuestLink({
      leads: { status: [{ id: 100, name: 'Бронь', status_id: 142, pipeline_id: 55 }] },
      contacts: { add: [{ id: 7, name: 'Олег Сидоров' }] },
    })
    assert.equal(out.name, 'Олег')
    assert.equal(out.externalId, '100')
    assert.equal(out.statusId, '142')
    assert.equal(out.pipelineId, '55')
  })

  it('без контакта берёт имя сделки', () => {
    const out = extractAmoGuestLink({ leads: { add: [{ id: '8', name: 'Павел' }] } })
    assert.equal(out.name, 'Павел')
    assert.equal(out.externalId, '8')
  })

  it('при allowLeadName: false не берёт название сделки', () => {
    const out = extractAmoGuestLink(
      { leads: { status: [{ id: 100, name: 'Бронь 12.08' }] } },
      {},
      { allowLeadName: false },
    )
    assert.equal(out.name, '')
    assert.equal(out.externalId, '100')
  })

  it('query category и JWT как запасной источник', () => {
    const out = extractAmoGuestLink(
      { token: jwtWith({ contact_name: 'Дарья Козлова', lead_id: 3 }) },
      { category: 'single' },
    )
    assert.equal(out.name, 'Дарья')
    assert.equal(out.externalId, '3')
    assert.equal(out.category, 'single')
  })

  it('не берёт сделку из leads.note (звонок Sipuni)', () => {
    const out = extractAmoGuestLink({
      leads: { note: [{ id: 456, status_id: 143, name: 'Закрыто и не реализовано' }] },
      notes: { add: [{ id: 10, entity_id: 456, note_type: 'call_in' }] },
    })
    assert.equal(out.externalId, '')
    assert.equal(out.statusId, '')
  })
})

describe('decodeJwtPayload', () => {
  it('читает payload без проверки подписи', () => {
    assert.equal(decodeJwtPayload(jwtWith({ a: 1 })).a, 1)
    assert.equal(decodeJwtPayload('not-a-jwt'), null)
  })
})

describe('extractAmoNoteEvents', () => {
  it('читает notes.add с entity_id', () => {
    const events = extractAmoNoteEvents({
      notes: {
        add: [{ id: 10, entity_id: 200, note_type: 'call_in' }],
      },
    })
    assert.equal(events.length, 1)
    assert.deepEqual(events[0], {
      noteId: '10',
      leadId: '200',
      contactId: '',
      noteType: 'call_in',
    })
  })

  it('не путает leads.note (id сделки) с id примечания', () => {
    assert.equal(
      extractAmoNoteEvents({
        leads: { note: [{ id: '25397453', status_id: 143 }] },
      }).length,
      0,
    )
  })

  it('берёт id сделки из leads.note для звонка на контакте', () => {
    const events = extractAmoNoteEvents({
      leads: { note: [{ id: '25397453' }] },
      notes: {
        add: [{ id: 77, entity_id: 999, entity_type: 'contact', note_type: 'call_in' }],
      },
    })
    assert.equal(events.length, 1)
    assert.equal(events[0].noteId, '77')
    assert.equal(events[0].leadId, '25397453')
    assert.equal(events[0].contactId, '999')
  })

  it('не подставляет id контакта как leadId', () => {
    const events = extractAmoNoteEvents({
      notes: {
        add: [{ id: 77, entity_id: 999, entity_type: 'contact', note_type: 'call_in' }],
      },
    })
    assert.equal(events.length, 1)
    assert.equal(events[0].leadId, '')
    assert.equal(events[0].contactId, '999')
  })

  it('читает вложенный leads.note[].note (формат amo/Kommo)', () => {
    const events = extractAmoNoteEvents({
      leads: {
        note: [
          {
            note: {
              id: '4600471',
              element_type: '2',
              element_id: '15320411',
              note_type: '10',
            },
          },
        ],
      },
    })
    assert.equal(events.length, 1)
    assert.equal(events[0].noteId, '4600471')
    assert.equal(events[0].leadId, '15320411')
    assert.equal(events[0].noteType, '10')
  })

  it('читает вложенный contacts.note[].note', () => {
    const events = extractAmoNoteEvents({
      contacts: {
        note: [
          {
            note: {
              id: '4600607',
              element_type: '1',
              element_id: '17614247',
              note_type: '11',
            },
            type: 'contact',
          },
        ],
      },
    })
    assert.equal(events.length, 1)
    assert.equal(events[0].noteId, '4600607')
    assert.equal(events[0].contactId, '17614247')
    assert.equal(events[0].leadId, '')
  })

  it('понимает числовой element_type 1/2 в notes.add', () => {
    const leadEvents = extractAmoNoteEvents({
      notes: { add: [{ id: 10, element_id: 456, element_type: '2', note_type: '10' }] },
    })
    assert.equal(leadEvents[0].leadId, '456')
    assert.equal(leadEvents[0].contactId, '')

    const contactEvents = extractAmoNoteEvents({
      notes: { add: [{ id: 11, element_id: 999, element_type: '1', note_type: '11' }] },
    })
    assert.equal(contactEvents[0].leadId, '')
    assert.equal(contactEvents[0].contactId, '999')
  })
})

describe('extractLeadIdsFromNoteWebhook', () => {
  it('берёт id сделки из leads.note', () => {
    assert.deepEqual(
      extractLeadIdsFromNoteWebhook({
        leads: { note: [{ id: '25397453', status_id: 143 }] },
      }),
      ['25397453'],
    )
  })

  it('берёт entity_id из notes.add для lead', () => {
    assert.deepEqual(
      extractLeadIdsFromNoteWebhook({
        notes: { add: [{ id: 10, entity_id: 456, entity_type: 'lead', note_type: 'call_in' }] },
      }),
      ['456'],
    )
  })

  it('не путает id контакта в notes.add с id сделки', () => {
    assert.deepEqual(
      extractLeadIdsFromNoteWebhook({
        leads: { note: [{ id: '25397453' }] },
        notes: { add: [{ id: 10, entity_id: 999, entity_type: 'contact', note_type: 'call_in' }] },
      }),
      ['25397453'],
    )
  })

  it('берёт element_id сделки из вложенного leads.note[].note, не id примечания', () => {
    assert.deepEqual(
      extractLeadIdsFromNoteWebhook({
        leads: {
          note: [{ note: { id: '4600471', element_type: '2', element_id: '15320411' } }],
        },
      }),
      ['15320411'],
    )
  })
})

describe('extractContactIdsFromNoteWebhook', () => {
  it('читает contacts.note и notes.add contact', () => {
    assert.deepEqual(
      extractContactIdsFromNoteWebhook({
        contacts: { note: [{ id: '888' }] },
        notes: { add: [{ id: 1, entity_id: 999, entity_type: 'contact', note_type: 'call_in' }] },
      }).sort(),
      ['888', '999'],
    )
  })

  it('берёт element_id контакта из вложенного contacts.note[].note', () => {
    assert.deepEqual(
      extractContactIdsFromNoteWebhook({
        contacts: {
          note: [{ note: { id: '4600607', element_type: '1', element_id: '17614247' }, type: 'contact' }],
        },
      }),
      ['17614247'],
    )
  })
})

describe('hasLeadStatusWebhook', () => {
  it('true при status_id в leads.status', () => {
    assert.equal(
      hasLeadStatusWebhook({ leads: { status: [{ id: 1, status_id: 142 }] } }),
      true,
    )
  })

  it('false для note-only webhook', () => {
    assert.equal(
      hasLeadStatusWebhook({ notes: { add: [{ id: 1, entity_id: 2, note_type: 'call_in' }] } }),
      false,
    )
  })

  it('false если status_id только в leads.note, не в leads.status', () => {
    assert.equal(
      hasLeadStatusWebhook({
        leads: { note: [{ id: 456, status_id: 143, pipeline_id: 1 }] },
        notes: { add: [{ id: 10, entity_id: 456, note_type: 'call_in' }] },
      }),
      false,
    )
  })
})

describe('shouldIssueGuestLinkFromAmoWebhook', () => {
  it('не выдаёт ссылку на note_lead со звонком', () => {
    const body = {
      leads: { note: [{ id: 456, status_id: 143, name: 'Закрыто' }] },
      notes: { add: [{ id: 10, entity_id: 456, note_type: 'call_in' }] },
    }
    assert.equal(isNoteLeadWebhook(body), true)
    assert.equal(shouldIssueGuestLinkFromAmoWebhook(body), false)
  })

  it('выдаёт ссылку на нативный leads.status (URL без параметров)', () => {
    assert.equal(
      shouldIssueGuestLinkFromAmoWebhook({
        leads: { status: [{ id: 31156581, status_id: 142, pipeline_id: 55 }] },
      }),
      true,
    )
  })

  it('не выдаёт на status без id сделки', () => {
    assert.equal(
      shouldIssueGuestLinkFromAmoWebhook({
        leads: { status: [{ status_id: 142, pipeline_id: 55 }] },
      }),
      false,
    )
  })

  it('выдаёт ссылку на Salesbot payload', () => {
    assert.equal(
      shouldIssueGuestLinkFromAmoWebhook({
        data: { name: 'Иван', 'lead.id': '99', category: 'default' },
      }),
      true,
    )
  })

  it('выдаёт ссылку на query-параметры Salesbot', () => {
    assert.equal(
      shouldIssueGuestLinkFromAmoWebhook({}, { name: 'Иван', externalId: '99', category: 'default' }),
      true,
    )
  })

  it('не выдаёт ссылку на пустой webhook', () => {
    assert.equal(shouldIssueGuestLinkFromAmoWebhook({}), false)
  })
})

describe('isPipelineAllowedForIssue', () => {
  it('без allowlist пускает любую воронку', () => {
    const prev = process.env.AMO_ISSUE_PIPELINE_IDS
    delete process.env.AMO_ISSUE_PIPELINE_IDS
    try {
      assert.equal(isPipelineAllowedForIssue('8922994'), true)
      assert.equal(shouldIssueAfterPipelineCheck('3813037'), true)
    } finally {
      if (prev == null) delete process.env.AMO_ISSUE_PIPELINE_IDS
      else process.env.AMO_ISSUE_PIPELINE_IDS = prev
    }
  })

  it('с allowlist пускает только тестовые воронки', () => {
    const prev = process.env.AMO_ISSUE_PIPELINE_IDS
    process.env.AMO_ISSUE_PIPELINE_IDS = '8922994'
    try {
      assert.equal(isPipelineAllowedForIssue('8922994'), true)
      assert.equal(isPipelineAllowedForIssue('3813037'), false)
      assert.equal(shouldIssueAfterPipelineCheck(''), false)
    } finally {
      if (prev == null) delete process.env.AMO_ISSUE_PIPELINE_IDS
      else process.env.AMO_ISSUE_PIPELINE_IDS = prev
    }
  })
})

describe('shouldRetryAmoCallSync', () => {
  it('повторяет, если новых звонков нет — URL записи мог ещё не доехать', () => {
    assert.equal(shouldRetryAmoCallSync({ inserted: [], skipped: 0, found: 1 }, []), true)
    assert.equal(shouldRetryAmoCallSync({ inserted: [], skipped: 2, found: 3 }, [{ noteType: 'call_in' }]), true)
    assert.equal(
      shouldRetryAmoCallSync({ inserted: [], skipped: 0, found: 0 }, [{ noteType: 'call_in' }]),
      true,
    )
    assert.equal(isCallLikeNoteType('10'), true)
    assert.equal(isCallLikeNoteType('common'), false)
  })

  it('не повторяет, если новый звонок уже записан', () => {
    assert.equal(shouldRetryAmoCallSync({ inserted: [{ id: 1 }], skipped: 0, found: 1 }, []), false)
  })
})

describe('shouldSyncCallsFromNoteEvents', () => {
  it('синхронизирует звонки и пустой payload', () => {
    assert.equal(shouldSyncCallsFromNoteEvents([]), true)
    assert.equal(shouldSyncCallsFromNoteEvents([{ noteType: 'call_in' }]), true)
    assert.equal(shouldSyncCallsFromNoteEvents([{ noteType: '10' }]), true)
    assert.equal(shouldSyncCallsFromNoteEvents([{ noteType: '' }]), true)
  })

  it('не гоняет amo на обычное текстовое примечание', () => {
    assert.equal(shouldSyncCallsFromNoteEvents([{ noteType: 'common' }]), false)
    assert.equal(shouldSyncCallsFromNoteEvents([{ noteType: '4' }]), false)
  })
})

describe('extractPhonesFromAmoWebhook', () => {
  it('берёт params.phone из contacts.note', () => {
    assert.deepEqual(
      extractPhonesFromAmoWebhook({
        contacts: {
          note: [{ note: { id: 1, note_type: '10', params: { phone: '8 900 123-45-67' } } }],
        },
      }),
      ['79001234567'],
    )
  })
})

describe('summarizeAmoWebhookBody', () => {
  it('снимает id и типы без текста', () => {
    const out = summarizeAmoWebhookBody({
      leads: { note: [{ id: '111' }] },
      notes: { add: [{ id: 10, entity_id: 111, entity_type: 'lead', note_type: 'call_in', text: 'секрет' }] },
    })
    assert.equal(out.leadsNote[0].id, '111')
    assert.equal(out.notesAdd[0].id, '10')
    assert.equal(out.notesAdd[0].noteType, 'call_in')
    assert.equal(JSON.stringify(out).includes('секрет'), false)
  })
})
