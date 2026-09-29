import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  formatCallSummaryNoteText,
  formatInsightsFactsBlock,
  formatOperatorReviewNoteText,
  inferAmoStatusType,
  isCallSummaryAllowed,
  isCallSummaryFeatureConfigured,
  isPostBookingStage,
  pickCallSummaryLeadCandidate,
} from './callSummaryPipeline.mjs'
import { normalizeOperatorReview, parseCallSummaryResponse } from './callSummaryExtract.mjs'

describe('isPostBookingStage', () => {
  it('этапы после брони — без разбора оператора', () => {
    assert.equal(isPostBookingStage({ statusId: '36751288', statusName: 'Забронировано' }), true)
    assert.equal(isPostBookingStage({ statusId: '36750040', statusName: 'Ждём оплату' }), true)
    assert.equal(isPostBookingStage({ statusId: '142', statusName: '' }), true)
  })

  it('воронка продаж и отказ — разбор разрешён', () => {
    assert.equal(isPostBookingStage({ statusId: '36750031', statusName: 'Обращение' }), false)
    assert.equal(
      isPostBookingStage({ statusId: '36750037', statusName: 'Предложение сделано' }),
      false,
    )
    assert.equal(
      isPostBookingStage({ statusId: '143', statusName: 'Закрыто и не реализовано' }),
      false,
    )
  })

  it('доп. этапы из AMO_CALL_REVIEW_SKIP_STATUS_IDS', () => {
    const prev = process.env.AMO_CALL_REVIEW_SKIP_STATUS_IDS
    process.env.AMO_CALL_REVIEW_SKIP_STATUS_IDS = '111, 222'
    try {
      assert.equal(isPostBookingStage({ statusId: '222', statusName: 'Прочее' }), true)
    } finally {
      if (prev == null) delete process.env.AMO_CALL_REVIEW_SKIP_STATUS_IDS
      else process.env.AMO_CALL_REVIEW_SKIP_STATUS_IDS = prev
    }
  })
})

describe('isCallSummaryAllowed', () => {
  it('без allowlist пускает все воронки', () => {
    const prevP = process.env.AMO_CALL_SUMMARY_PIPELINE_IDS
    const prevS = process.env.AMO_CALL_SUMMARY_STATUS_IDS
    const prevIp = process.env.AMO_ISSUE_PIPELINE_IDS
    const prevIs = process.env.AMO_ISSUE_STATUS_IDS
    delete process.env.AMO_CALL_SUMMARY_PIPELINE_IDS
    delete process.env.AMO_CALL_SUMMARY_STATUS_IDS
    process.env.AMO_ISSUE_PIPELINE_IDS = '3813037'
    process.env.AMO_ISSUE_STATUS_IDS = '87975206'
    try {
      assert.equal(isCallSummaryFeatureConfigured(), true)
      assert.equal(isCallSummaryAllowed('3813037', '87975206'), true)
      assert.equal(isCallSummaryAllowed('999', '1'), true)
      assert.equal(isCallSummaryAllowed('', ''), true)
    } finally {
      restoreEnv('AMO_CALL_SUMMARY_PIPELINE_IDS', prevP)
      restoreEnv('AMO_CALL_SUMMARY_STATUS_IDS', prevS)
      restoreEnv('AMO_ISSUE_PIPELINE_IDS', prevIp)
      restoreEnv('AMO_ISSUE_STATUS_IDS', prevIs)
    }
  })

  it('AMO_CALL_SUMMARY_* ограничивает воронку/этап', () => {
    const prevP = process.env.AMO_CALL_SUMMARY_PIPELINE_IDS
    const prevS = process.env.AMO_CALL_SUMMARY_STATUS_IDS
    process.env.AMO_CALL_SUMMARY_PIPELINE_IDS = '111'
    process.env.AMO_CALL_SUMMARY_STATUS_IDS = '222'
    try {
      assert.equal(isCallSummaryAllowed('111', '222'), true)
      assert.equal(isCallSummaryAllowed('3813037', '87975206'), false)
      assert.equal(isCallSummaryAllowed('111', '999'), false)
    } finally {
      restoreEnv('AMO_CALL_SUMMARY_PIPELINE_IDS', prevP)
      restoreEnv('AMO_CALL_SUMMARY_STATUS_IDS', prevS)
    }
  })
})

describe('formatCallSummaryNoteText', () => {
  it('собирает итог и следующий шаг', () => {
    const text = formatCallSummaryNoteText({
      direction: 'in',
      capturedAt: '2026-09-15T11:32:00.000Z',
      durationSec: 258,
      outcome: 'Интересует номер с видом с 19 сентября.',
      nextStep: 'Отправить расчёт до пятницы.',
    })
    assert.match(text, /^Входящий · 15\.09, 14:32 · 4:18/)
    assert.match(text, /Итог: Интересует номер с видом с 19 сентября\./)
    assert.match(text, /Следующий шаг: Отправить расчёт до пятницы\./)
  })

  it('добавляет факты и сигнал повторного контакта', () => {
    const text = formatCallSummaryNoteText({
      direction: 'in',
      outcome: 'Хочет dual',
      nextStep: 'Перезвонить',
      facts: {
        checkIn: '19.09',
        checkOut: '26.09',
        guests: 2,
        roomCategory: 'dual',
        treatment: null,
        budgetMax: 80000,
        source: 'site',
      },
      warmRepeatSignal: 'гость звонил 3 раза, интерес тёплый, бронь не закрыта',
    })
    assert.match(text, /Факты:/)
    assert.match(text, /Даты: 19\.09 → 26\.09/)
    assert.match(text, /Бюджет до: 80\s?000 ₽/)
    assert.match(text, /Канал: сайт/)
    assert.match(text, /⚠ Повторный контакт: гость звонил 3 раза/)
  })
})

describe('formatInsightsFactsBlock', () => {
  it('пустой без фактов', () => {
    assert.equal(formatInsightsFactsBlock(null), '')
    assert.equal(formatInsightsFactsBlock({}), '')
  })
})

describe('buildWarmRepeatSignal', () => {
  it('срабатывает с 3 звонков и тёплым intent', async () => {
    const { buildWarmRepeatSignal } = await import('./amoCallSummaries.mjs')
    assert.equal(
      buildWarmRepeatSignal({ callCount: 2, intent: 'booking' }),
      null,
    )
    assert.match(
      buildWarmRepeatSignal({ callCount: 3, intent: 'booking' }) || '',
      /звонил 3 раза/,
    )
    assert.equal(
      buildWarmRepeatSignal({ callCount: 3, intent: 'queue', declineReason: 'comparing' }),
      null,
    )
  })
})

describe('formatOperatorReviewNoteText', () => {
  it('отдельная заметка с маркером разбора', () => {
    const text = formatOperatorReviewNoteText({
      miss: 'Не предложил зафиксировать бронь',
      detail: 'Места были, гость ушёл думать.',
    })
    assert.match(text, /^⚠ РАЗБОР ОПЕРАТОРА/)
    assert.match(text, /Не предложил зафиксировать бронь/)
    assert.match(text, /Места были/)
  })
})

describe('parseCallSummaryResponse', () => {
  it('читает JSON outcome/nextStep', () => {
    const parsed = parseCallSummaryResponse(
      '{"outcome":"Хочет dual","nextStep":"Прислать цены"}',
    )
    assert.equal(parsed.ok, true)
    assert.equal(parsed.outcome, 'Хочет dual')
    assert.equal(parsed.nextStep, 'Прислать цены')
    assert.equal(parsed.operatorReview, null)
  })

  it('принимает fence', () => {
    const parsed = parseCallSummaryResponse('```json\n{"outcome":"A","nextStep":"B"}\n```')
    assert.equal(parsed.ok, true)
    assert.equal(parsed.outcome, 'A')
    assert.equal(parsed.nextStep, 'B')
  })

  it('читает operatorReview', () => {
    const parsed = parseCallSummaryResponse(
      JSON.stringify({
        outcome: 'Хотел dual, места есть, ушёл думать',
        nextStep: 'Перезвонить завтра',
        operatorReview: {
          miss: 'Не закрыл на бронь',
          detail: 'Гость готов был бронировать, оператор не предложил фиксацию.',
        },
      }),
    )
    assert.equal(parsed.ok, true)
    assert.equal(parsed.operatorReview?.miss, 'Не закрыл на бронь')
  })
})

describe('normalizeOperatorReview', () => {
  it('null для информационного / пустого', () => {
    assert.equal(normalizeOperatorReview(null), null)
    assert.equal(normalizeOperatorReview('null'), null)
    assert.equal(normalizeOperatorReview({}), null)
  })
})

describe('pickCallSummaryLeadCandidate', () => {
  it('предпочитает открытую сделку закрытой (отказ)', () => {
    const picked = pickCallSummaryLeadCandidate([
      { leadId: '25518665', statusType: 2, updatedAtMs: 2000, hasLink: false },
      { leadId: '31140898', statusType: 0, updatedAtMs: 1000, hasLink: false },
    ])
    assert.equal(picked.leadId, '31140898')
  })

  it('среди закрытых предпочитает успех отказу', () => {
    const picked = pickCallSummaryLeadCandidate([
      { leadId: 'lost', statusType: 2, updatedAtMs: 9000, hasLink: false },
      { leadId: 'won', statusType: 1, updatedAtMs: 1000, hasLink: false },
    ])
    assert.equal(picked.leadId, 'won')
  })

  it('ссылка презентации важнее стадии', () => {
    const picked = pickCallSummaryLeadCandidate([
      { leadId: 'open', statusType: 0, updatedAtMs: 9000, hasLink: false },
      { leadId: 'with-link', statusType: 2, updatedAtMs: 1000, hasLink: true },
    ])
    assert.equal(picked.leadId, 'with-link')
  })
})

describe('inferAmoStatusType', () => {
  it('берёт тип из воронки, иначе 142/143', () => {
    assert.equal(inferAmoStatusType('999', 0), 0)
    assert.equal(inferAmoStatusType('142', null), 1)
    assert.equal(inferAmoStatusType('143', null), 2)
  })
})

function restoreEnv(key, prev) {
  if (prev == null) delete process.env[key]
  else process.env[key] = prev
}
