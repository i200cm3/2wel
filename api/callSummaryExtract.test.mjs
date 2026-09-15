import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildOperatorReviewPrompt,
  normalizeOperatorReview,
  parseCallSummaryResponse,
  parseOperatorReviewResponse,
  sanitizeCallSummaryFacts,
  shouldRunOperatorReviewPass,
} from './callSummaryExtract.mjs'

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
    assert.equal(parsed.operatorReview, null)
  })

  it('нормализует operatorReview', () => {
    assert.equal(normalizeOperatorReview(null), null)
    assert.deepEqual(
      normalizeOperatorReview({ miss: 'Не предложил бронь', detail: 'Места были.' }),
      { miss: 'Не предложил бронь', detail: 'Места были.' },
    )
  })
})

describe('shouldRunOperatorReviewPass', () => {
  it('включает коммерческий срыв', () => {
    assert.equal(
      shouldRunOperatorReviewPass({
        outcome: 'Хотел бронь с 5 октября, мест нет, ушёл',
        nextStep: 'Уточнить интерес',
      }),
      true,
    )
  })

  it('пропускает закрытую бронь', () => {
    assert.equal(
      shouldRunOperatorReviewPass({
        outcome: 'Клиент забронировал номер на 16 ноября, выставили счёт',
        nextStep: 'дальнейших действий не требуется',
      }),
      false,
    )
  })

  it('пропускает документы без брони', () => {
    assert.equal(
      shouldRunOperatorReviewPass({
        outcome: 'Клиент сообщил об ошибке в документе, нужно исправить калькулятор',
        nextStep: 'Ждать скан от клиента',
      }),
      false,
    )
  })
})

describe('parseOperatorReviewResponse', () => {
  it('читает null', () => {
    const parsed = parseOperatorReviewResponse('{"operatorReview":null}')
    assert.equal(parsed.ok, true)
    assert.equal(parsed.operatorReview, null)
  })

  it('читает miss/detail', () => {
    const parsed = parseOperatorReviewResponse(
      '{"operatorReview":{"miss":"не предложил другие даты","detail":"Мест нет, альтернатив не было."}}',
    )
    assert.equal(parsed.ok, true)
    assert.equal(parsed.operatorReview?.miss, 'не предложил другие даты')
  })
})

describe('reconcileOperatorReview', () => {
  it('сбрасывает разбор, если в detail уже есть предложение и отказ', async () => {
    const { reconcileOperatorReview } = await import('./callSummaryExtract.mjs')
    assert.equal(
      reconcileOperatorReview(
        {
          miss: 'не предложил конкретные даты',
          detail:
            'Оператор предложил номер с 26 сентября, но клиент отказался. На 21 октября тоже предложили.',
        },
        { outcome: 'Были предложены даты, клиент отказался' },
      ),
      null,
    )
  })

  it('сбрасывает разбор, если в outcome уже есть конкретная доступная дата', async () => {
    const { reconcileOperatorReview } = await import('./callSummaryExtract.mjs')
    assert.equal(
      reconcileOperatorReview(
        {
          miss: 'не предложил альтернативных дат',
          detail: 'Оператор не предложил альтернативных дат.',
        },
        {
          outcome:
            'На 21 октября есть предложение двухкомнатного премиум-номера. Клиент отказался.',
        },
      ),
      null,
    )
  })

  it('оставляет разбор, если альтернатив не было', async () => {
    const { reconcileOperatorReview } = await import('./callSummaryExtract.mjs')
    const review = {
      miss: 'не предложил другие даты',
      detail: 'Оператор сказал, что только в ноябре, но не предложил конкретные даты.',
    }
    assert.deepEqual(reconcileOperatorReview(review, { outcome: 'Мест нет с 5 октября' }), review)
  })
})
