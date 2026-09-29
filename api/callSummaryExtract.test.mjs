import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildOperatorReviewPrompt,
  buildOperatorReviewVerifyPrompt,
  buildCallSummaryRepairPrompt,
  callSummaryResponseNeedsRepair,
  containsCjkScript,
  deriveNeedsFollowUp,
  isCallInsightsTargetCall,
  isQueueHoldTranscript,
  normalizeCallInsights,
  normalizeOperatorReview,
  parseCallInsightsResponse,
  parseCallSummaryResponse,
  parseOperatorReviewResponse,
  rewriteClientAsGuest,
  sanitizeCallSummaryFacts,
  shouldRunOperatorReviewPass,
  containsMixedScriptWord,
  operatorReviewLooksBroken,
  transcriptShowsExistingBooking,
} from './callSummaryExtract.mjs'

describe('rewriteClientAsGuest', () => {
  it('меняет склонения клиент → гость', () => {
    assert.equal(
      rewriteClientAsGuest('Клиент хочет трансфер, клиенту предложили дату'),
      'Гость хочет трансфер, гостю предложили дату',
    )
    assert.equal(rewriteClientAsGuest('Ждать скан от клиента'), 'Ждать скан от гостя')
  })

  it('после замены чинит род: уточнила → уточнил', () => {
    assert.equal(
      rewriteClientAsGuest('Клиент уточнила дату заезда и спросила про трансфер'),
      'Гость уточнил дату заезда и спросил про трансфер',
    )
    assert.equal(rewriteClientAsGuest('Гость согласилась подумать'), 'Гость согласился подумать')
  })

  it('разклеивает Гость+глагол без пробела', () => {
    assert.equal(
      rewriteClientAsGuest('Гостьуточнил наличие стандартных номеров'),
      'Гость уточнил наличие стандартных номеров',
    )
    assert.equal(
      rewriteClientAsGuest('Клиентуточнила дату заезда'),
      'Гость уточнил дату заезда',
    )
    assert.equal(rewriteClientAsGuest('Клиент уточнила дату'), 'Гость уточнил дату')
    assert.equal(rewriteClientAsGuest('Ждать скан от клиента'), 'Ждать скан от гостя')
  })
})

describe('containsCjkScript', () => {
  it('ловит китайский в саммари', () => {
    assert.equal(containsCjkScript('Гость хочет dual'), false)
    assert.equal(containsCjkScript('Гость表达了对双人间的兴趣'), true)
  })
})

describe('callSummaryResponseNeedsRepair', () => {
  it('чинит битый JSON', () => {
    assert.equal(callSummaryResponseNeedsRepair({ ok: false, error: 'extract_parse_failed' }, ''), true)
  })

  it('чинит CJK в сыром ответе даже до parse', () => {
    assert.equal(
      callSummaryResponseNeedsRepair(null, '{"outcome":"Гость уточнил, что他已经"}'),
      true,
    )
  })

  it('чинит CJK в распарсенных полях', () => {
    assert.equal(
      callSummaryResponseNeedsRepair(
        { ok: true, outcome: 'Гость表达了兴趣', nextStep: 'Перезвонить' },
        '',
      ),
      true,
    )
  })

  it('не трогает нормальный ответ', () => {
    assert.equal(
      callSummaryResponseNeedsRepair(
        { ok: true, outcome: 'Гость уточнил оплату.', nextStep: 'Ждать ответ агентства' },
        '{"outcome":"Гость уточнил оплату.","nextStep":"Ждать ответ агентства"}',
      ),
      false,
    )
  })
})

describe('buildCallSummaryRepairPrompt', () => {
  it('содержит транскрипт и блок исправления', () => {
    const prompt = buildCallSummaryRepairPrompt('Оператор: здравствуйте\nГость: оплатил счёт')
    assert.match(prompt, /оплатил счёт/)
    assert.match(prompt, /ИСПРАВЛЕНИЕ/)
    assert.match(prompt, /кириллица/i)
  })
})

describe('sanitizeCallSummaryFacts', () => {
  it('убирает выдуманную цену без ценового контекста в транскрипте', () => {
    const transcript =
      'Спина болит. Массаж завтра пойду. Массаж но шесть семь. Мы сейчас прервёмся.'
    const out = sanitizeCallSummaryFacts(transcript, {
      outcome:
        'Гость сообщил о боли в спине и намерен записаться на массаж. Стоимость услуги составит 6700 рублей.',
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
        outcome: 'Гость забронировал номер на 16 ноября, выставили счёт',
        nextStep: 'дальнейших действий не требуется',
      }),
      false,
    )
  })

  it('пропускает подтверждение существующей брони', () => {
    assert.equal(
      shouldRunOperatorReviewPass({
        outcome: 'Гость подтвердил заезд 28 числа, путёвка уже оформлена',
        nextStep: 'Ждать гостя',
      }),
      false,
    )
  })

  it('пропускает документы без брони', () => {
    assert.equal(
      shouldRunOperatorReviewPass({
        outcome: 'Гость сообщил об ошибке в документе, нужно исправить калькулятор',
        nextStep: 'Ждать скан от гостя',
      }),
      false,
    )
  })
})

describe('transcriptShowsExistingBooking', () => {
  it('ловит подтверждение заезда по купленной путёвке', () => {
    const transcript = [
      'Клиент: Мы приезжаем в понедельник. У нас всё в силе остаётся.',
      'Оператор: Так, путёвка у вас с понедельника или со вторника?',
      'Клиент: Мы, когда бронировали, нам записали номер без балкона.',
      'Оператор: Они видят к вашей брони, что вы хотите стандарт с балконом.',
    ].join('\n')
    assert.equal(transcriptShowsExistingBooking(transcript), true)
  })

  it('не срабатывает на новую продажу', () => {
    const transcript = [
      'Клиент: Хотим забронировать номер с 5 октября на двоих.',
      'Оператор: У нас путёвки от семи дней. На 5 октября мест нет, только ноябрь.',
      'Клиент: У вас бронирование через сайт тоже можно?',
      'Оператор: А в какую дату у вас путёвка? Давайте посмотрим.',
      'Оператор: В вашу путёвку будут входить ванны, грязи, бассейн.',
      'Оператор: Стоимость путёвки у вас составляет 82 500.',
    ].join('\n')
    assert.equal(transcriptShowsExistingBooking(transcript), false)
  })
})

describe('operatorReviewLooksBroken', () => {
  it('ловит латиницу внутри русского слова', () => {
    assert.equal(containsMixedScriptWord('альтernативных дат'), true)
    assert.equal(containsMixedScriptWord('номер с Wi-Fi и SPA'), false)
    assert.equal(
      operatorReviewLooksBroken({
        miss: 'Недоработка',
        detail: 'Оператор не предложил альтernативных дат.',
      }),
      true,
    )
    assert.equal(
      operatorReviewLooksBroken({ miss: 'не предложил другие даты', detail: 'Мест нет.' }),
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

describe('buildOperatorReviewVerifyPrompt', () => {
  it('подставляет кандидат miss/detail и транскрипт', () => {
    const prompt = buildOperatorReviewVerifyPrompt(
      'Оператор: Числа двадцать четвёртого.\nКлиент: Октября же, да?',
      {
        miss: 'не предложил альтернативных дат',
        detail: 'Оператор не предложил другие даты.',
        outcome: 'Обсуждена бронь на 24 октября',
        nextStep: 'Уточнить интерес',
      },
    )
    assert.match(prompt, /не предложил альтернативных дат/)
    assert.match(prompt, /Числа двадцать четвёртого/)
    assert.match(prompt, /Обсуждена бронь на 24 октября/)
    assert.match(prompt, /Источник истины/)
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
            'Оператор предложил номер с 26 сентября, но гость отказался. На 21 октября тоже предложили.',
        },
        { outcome: 'Были предложены даты, гость отказался' },
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
            'На 21 октября есть предложение двухкомнатного премиум-номера. Гость отказался.',
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

describe('normalizeCallInsights', () => {
  it('нормализует enum и факты', () => {
    const insights = normalizeCallInsights(
      {
        intent: 'Booking',
        declineReason: 'dates-full',
        topics: [
          { topic: 'food', addressed: true },
          { topic: 'food', addressed: false },
          { topic: 'unknown', addressed: true },
        ],
        facts: {
          checkIn: '16 ноября',
          guests: '2 взрослых',
          budgetMax: 50000,
          source: 'site',
        },
        needsFollowUp: true,
      },
      {
        transcript: 'Бюджет до 50000 рублей, заезд 16 ноября',
        nextStep: 'Перезвонить завтра',
      },
    )
    assert.equal(insights.intent, 'booking')
    assert.equal(insights.declineReason, 'dates_full')
    assert.deepEqual(insights.topics, [{ topic: 'food', addressed: true }])
    assert.equal(insights.facts.checkIn, '16 ноября')
    assert.equal(insights.facts.guests, 2)
    assert.equal(insights.facts.budgetMax, 50000)
    assert.equal(insights.facts.source, 'site')
    assert.equal(insights.needsFollowUp, true)
  })

  it('other без label отбрасывает, с label сохраняет', () => {
    const insights = normalizeCallInsights(
      {
        intent: 'other',
        topics: [
          { topic: 'other', addressed: true },
          { topic: 'other', label: 'Справка об эпидобстановке', addressed: true },
          { topic: 'pool', addressed: false },
        ],
        facts: {},
        needsFollowUp: false,
      },
      { transcript: '', nextStep: '' },
    )
    assert.deepEqual(insights.topics, [
      { topic: 'other', addressed: true, label: 'Справка об эпидобстановке' },
      { topic: 'pool', addressed: false },
    ])
  })

  it('сбрасывает budgetMax без ценового контекста в транскрипте', () => {
    const insights = normalizeCallInsights(
      { facts: { budgetMax: 6700 }, needsFollowUp: false },
      { transcript: 'Массаж но шесть семь', nextStep: 'дальнейших действий не требуется' },
    )
    assert.equal(insights.facts.budgetMax, null)
    assert.equal(insights.needsFollowUp, false)
  })

  it('форсирует queue для IVR «все менеджеры на линии»', () => {
    const transcript =
      'Вас приветствует санаторий. В данный момент все менеджеры на линии. Мы зафиксировали ваш звонок. Вам перезвонят.'
    assert.equal(isQueueHoldTranscript(transcript), true)
    const insights = normalizeCallInsights(
      { intent: 'booking', needsFollowUp: true, facts: { guests: 2 } },
      {
        transcript,
        outcome: 'Хотел бронь, все менеджеры на линии',
        nextStep: 'Уточнить интерес при следующем контакте',
      },
    )
    assert.equal(insights.intent, 'queue')
    assert.equal(insights.needsFollowUp, false)
    assert.equal(insights.facts.guests, null)
  })

  it('не ставит needsFollowUp на общий nextStep без сигнала', () => {
    const insights = normalizeCallInsights(
      { intent: 'other', needsFollowUp: true },
      {
        transcript: 'Здравствуйте, мы ошиблись номером.',
        outcome: 'Ошибочный звонок без интереса к брони',
        nextStep: 'Уточнить интерес при следующем контакте',
      },
    )
    assert.equal(insights.needsFollowUp, false)
  })

  it('ставит comparing, если ушёл в другой санаторий', () => {
    const insights = normalizeCallInsights(
      { intent: 'booking', declineReason: 'other', needsFollowUp: false },
      {
        transcript: 'Я уже в другом санатории живу, спасибо.',
        outcome: 'Гость отказался, уже в другом санатории',
        nextStep: 'дальнейших действий не требуется',
      },
    )
    assert.equal(insights.declineReason, 'comparing')
  })

  it('перебивает pricing → documents при документах ребёнка', () => {
    const insights = normalizeCallInsights(
      { intent: 'pricing', needsFollowUp: false },
      {
        transcript: 'Нужны документы на ребёнка четыре года.',
        outcome:
          'Гость хотел отдохнуть с ребёнком 4 лет, но не смог согласовать необходимые документы для ребёнка и отказался от бронирования.',
        nextStep: 'Уточнить интерес при следующем контакте.',
      },
    )
    assert.equal(insights.intent, 'documents')
  })

  it('перебивает pricing → transfer при вопросе про трансфер', () => {
    const insights = normalizeCallInsights(
      { intent: 'pricing', needsFollowUp: false },
      {
        transcript: 'Трансфер стоит две тысячи двести рублей.',
        outcome: 'Гость уточняла информацию о трансфере и его стоимости.',
        nextStep: 'дальнейших действий не требуется',
      },
    )
    assert.equal(insights.intent, 'transfer')
  })

  it('перебивает queue → transfer при транспорте с вокзала (без слова «трансфер»)', () => {
    const insights = normalizeCallInsights(
      { intent: 'queue', needsFollowUp: false, topics: [{ topic: 'arrival', addressed: true }] },
      {
        transcript:
          'Гость: вы можете транспорт, чтобы нас встретили с ЖД-вокзала?\nОператор: на Привокзальной площади будет стоять наша машина, сброшу телефон дежурного водителя.',
        outcome:
          'Гость уточнил время прибытия и способы встречи с транспортом. Бронь не была обсуждена',
        nextStep: 'Уточнить интерес при следующем контакте',
      },
    )
    assert.equal(insights.intent, 'transfer')
  })

  it('перебивает treatment → paid_medical при платных медуслугах без брони', () => {
    const insights = normalizeCallInsights(
      { intent: 'treatment', needsFollowUp: false },
      {
        transcript: 'Хочу записаться на платную консультацию и УЗИ.',
        outcome: 'Гость интересовался платными медицинскими услугами: консультация и УЗИ.',
        nextStep: 'дальнейших действий не требуется',
      },
    )
    assert.equal(insights.intent, 'paid_medical')
  })

  it('не ставит paid_medical, если идёт подбор путёвки с лечением', () => {
    const insights = normalizeCallInsights(
      { intent: 'booking', needsFollowUp: true },
      {
        transcript: 'Нужна путёвка с лечением, интересуют платные процедуры дополнительно.',
        outcome: 'Гость запросил бронирование путёвки с лечением на две недели.',
        nextStep: 'Прислать варианты номеров',
      },
    )
    assert.equal(insights.intent, 'booking')
  })
})

describe('deriveNeedsFollowUp', () => {
  it('true только при конкретном перезвоне', () => {
    assert.equal(
      deriveNeedsFollowUp('Перезвонить завтра после обеда', true, {
        outcome: 'Договорились созвониться',
      }),
      true,
    )
    assert.equal(
      deriveNeedsFollowUp('Уточнить интерес при следующем контакте', true, {
        outcome: 'Гость подумает',
        transcript: 'Хорошо, я подумаю',
      }),
      false,
    )
  })

  it('true для think даже без явного needsFollowUp модели', () => {
    assert.equal(
      deriveNeedsFollowUp('Уточнить интерес при следующем контакте', null, {
        outcome: 'Мест нет, гость подумает',
        declineReason: 'think',
        intent: 'booking',
      }),
      true,
    )
  })

  it('true для nextStep с действием менеджера', () => {
    assert.equal(
      deriveNeedsFollowUp('Прислать варианты на ноябрь в WhatsApp', null, {
        outcome: 'Смотрели даты',
        intent: 'booking',
      }),
      true,
    )
  })

  it('true для dates_full и незакрытого интереса в outcome', () => {
    assert.equal(
      deriveNeedsFollowUp('Уточнить интерес при следующем контакте', false, {
        outcome: 'Мест с 5 октября нет',
        declineReason: 'dates_full',
        intent: 'booking',
      }),
      true,
    )
    assert.equal(
      deriveNeedsFollowUp('Уточнить интерес при следующем контакте', null, {
        outcome: 'Гость согласилась забронировать номер на три ночи',
        intent: 'booking',
      }),
      true,
    )
  })

  it('false для comparing без конкретного перезвона', () => {
    assert.equal(
      deriveNeedsFollowUp('Уточнить интерес при следующем контакте', true, {
        outcome: 'Гость уже в другом санатории',
        declineReason: 'comparing',
        intent: 'booking',
      }),
      false,
    )
  })
})

describe('isCallInsightsTargetCall', () => {
  it('берёт бронь и отсекает ошибку/водителя', () => {
    assert.equal(
      isCallInsightsTargetCall({
        outcome: 'Хотел бронь с 5 октября, мест нет',
        nextStep: 'Уточнить интерес',
      }),
      true,
    )
    assert.equal(
      isCallInsightsTargetCall({
        outcome: 'Гость записал телефон водителя с ограничениями на номере',
        nextStep: 'Уточнить интерес при следующем контакте',
      }),
      false,
    )
    assert.equal(
      isCallInsightsTargetCall({
        outcome: 'Гость позвонил по ошибке, не выразил интереса к бронированию',
        nextStep: 'Уточнить интерес при следующем контакте',
      }),
      false,
    )
  })
})

describe('parseCallInsightsResponse', () => {
  it('читает JSON', () => {
    const parsed = parseCallInsightsResponse(
      '{"intent":"pricing","declineReason":null,"topics":[],"facts":{},"needsFollowUp":false}',
      { nextStep: 'дальнейших действий не требуется' },
    )
    assert.equal(parsed.ok, true)
    assert.equal(parsed.insights.intent, 'pricing')
    assert.equal(parsed.insights.needsFollowUp, false)
  })
})
