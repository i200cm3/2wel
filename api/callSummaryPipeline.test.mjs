import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  formatCallSummaryNoteText,
  isCallSummaryAllowed,
  isCallSummaryFeatureConfigured,
} from './callSummaryPipeline.mjs'
import { parseCallSummaryResponse } from './callSummaryExtract.mjs'

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
    assert.match(text, /^Входящий · /)
    assert.match(text, /4:18/)
    assert.match(text, /Итог: Интересует номер с видом с 19 сентября\./)
    assert.match(text, /Следующий шаг: Отправить расчёт до пятницы\./)
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
  })

  it('принимает fence', () => {
    const parsed = parseCallSummaryResponse('```json\n{"outcome":"A","nextStep":"B"}\n```')
    assert.equal(parsed.ok, true)
    assert.equal(parsed.outcome, 'A')
    assert.equal(parsed.nextStep, 'B')
  })
})

function restoreEnv(key, prev) {
  if (prev == null) delete process.env[key]
  else process.env[key] = prev
}
