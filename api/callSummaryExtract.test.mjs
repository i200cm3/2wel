import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseCallSummaryResponse, sanitizeCallSummaryFacts } from './callSummaryExtract.mjs'

describe('sanitizeCallSummaryFacts', () => {
  it('убирает выдуманную цену без ценового контекста в транскрипте', () => {
    const transcript =
      'Спина болит. Массаж завтра пойду. Массаж но шесть семь. Мы сейчас прервёмся.'
    const out = sanitizeCallSummaryFacts(transcript, {
      outcome:
        'Клиент сообщил о боли в спине и намерен записаться на массаж. Стоимость услуги составит 6700 рублей.',
      nextStep: 'Уточнить дату массажа.',
    })
    assert.doesNotMatch(out.outcome, /6700/)
    assert.doesNotMatch(out.outcome, /руб|цена|стоимост/i)
  })

  it('убирает фразу «была упомянута цена» без контекста', () => {
    const out = sanitizeCallSummaryFacts('Массаж но шесть семь.', {
      outcome: 'Намерен пойти на массаж завтра. Была упомянута цена массажа.',
      nextStep: 'Уточнить интерес.',
    })
    assert.doesNotMatch(out.outcome, /цена/i)
  })

  it('оставляет цену, если в транскрипте есть «рублей»', () => {
    const transcript = 'Массаж стоит шесть тысяч семьсот рублей, запишем на завтра?'
    const out = sanitizeCallSummaryFacts(transcript, {
      outcome: 'Согласовали массаж за 6700 рублей.',
      nextStep: 'Подтвердить время.',
    })
    assert.match(out.outcome, /6700/)
  })
})

describe('parseCallSummaryResponse', () => {
  it('читает JSON', () => {
    const parsed = parseCallSummaryResponse('{"outcome":"A","nextStep":"B"}')
    assert.equal(parsed.ok, true)
    assert.equal(parsed.outcome, 'A')
  })
})
