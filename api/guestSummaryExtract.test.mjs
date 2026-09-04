import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildRawTextFromSources,
  collectDialogBodies,
  parseGuestSummaryExtractResponse,
} from './guestSummaryExtract.mjs'

describe('collectDialogBodies', () => {
  it('skips empty bodies and recording URLs', () => {
    const items = collectDialogBodies([
      { id: '1', kind: 'call_transcript', title: 'Звонок', body: 'https://sipuni.example/rec.mp3' },
      { id: '2', kind: 'call_transcript', title: 'Звонок 2', body: 'Клиент: хочу с 19 сентября' },
      { id: '3', kind: 'chat', title: '', body: '   ' },
      { id: '4', kind: 'note', title: 'Заметка', body: 'Одноместный' },
      {
        id: '5',
        kind: 'chat',
        title: 'Спам',
        body: 'Не про санаторий',
        meta: { nonTarget: true },
      },
    ])
    assert.equal(items.length, 2)
    assert.equal(items[0].id, '2')
    assert.equal(items[1].id, '4')
  })
})

describe('buildRawTextFromSources', () => {
  it('returns error when no text sources', () => {
    const result = buildRawTextFromSources([
      { kind: 'call_transcript', body: 'https://example.com/a.mp3' },
    ])
    assert.equal(result.ok, false)
  })

  it('joins labeled chunks', () => {
    const result = buildRawTextFromSources([
      { kind: 'call_transcript', title: 'Входящий', body: 'Текст звонка', capturedAt: '2026-09-01' },
      { kind: 'chat', title: 'WhatsApp', body: 'Текст чата' },
    ])
    assert.equal(result.ok, true)
    assert.match(result.rawText, /Звонок: Входящий/)
    assert.match(result.rawText, /Текст звонка/)
    assert.match(result.rawText, /Чат: WhatsApp/)
  })
})

describe('parseGuestSummaryExtractResponse', () => {
  it('parses JSON then explanation', () => {
    const raw = `{
  "guestName": "Иван",
  "dates": "с 19 сентября",
  "partyType": "solo",
  "room": "single",
  "topics": "room, price",
  "objections": "dates-not-fixed",
  "confidence": "0.75",
  "fillRemaining": "soft"
}

Даты взяты из финального оффера менеджера.`
    const parsed = parseGuestSummaryExtractResponse(raw)
    assert.equal(parsed.ok, true)
    assert.equal(parsed.summary.guestName, 'Иван')
    assert.equal(parsed.summary.dates, 'с 19 сентября')
    assert.equal(parsed.summary.fillRemaining, 'soft')
    assert.match(parsed.explanation, /Даты взяты/)
  })

  it('parses fenced JSON with trailing explanation', () => {
    const raw = `Кратко:

\`\`\`json
{"guestName":"","dates":"ноябрь","partyType":"couple","room":"","topics":"food","objections":"","confidence":"0.5","fillRemaining":"aggressive"}
\`\`\`

Мало фактов, широкий дожим.`
    const parsed = parseGuestSummaryExtractResponse(raw)
    assert.equal(parsed.ok, true)
    assert.equal(parsed.summary.dates, 'ноябрь')
    assert.equal(parsed.summary.fillRemaining, 'aggressive')
    assert.match(parsed.explanation, /Мало фактов/)
  })

  it('rejects missing JSON', () => {
    const parsed = parseGuestSummaryExtractResponse('просто текст без объекта')
    assert.equal(parsed.ok, false)
  })
})
