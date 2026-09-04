import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  addMonths,
  currentPeriod,
  isPlanUpgrade,
  normalizePlanId,
  planById,
  PLANS,
  usageSummary,
} from './plans.mjs'

describe('addMonths', () => {
  it('держит день месяца', () => {
    assert.equal(addMonths(new Date('2026-01-15T10:00:00Z'), 1).toISOString(), '2026-02-15T10:00:00.000Z')
    assert.equal(addMonths(new Date('2026-01-15T10:00:00Z'), 12).toISOString(), '2027-01-15T10:00:00.000Z')
  })

  it('поджимает день к длине короткого месяца', () => {
    assert.equal(addMonths(new Date('2026-01-31T00:00:00Z'), 1).toISOString(), '2026-02-28T00:00:00.000Z')
    assert.equal(addMonths(new Date('2024-01-31T00:00:00Z'), 1).toISOString(), '2024-02-29T00:00:00.000Z')
  })
})

describe('currentPeriod', () => {
  it('привязан ко дню подключения, а не к первому числу', () => {
    const period = currentPeriod('2026-01-15T00:00:00Z', '2026-03-20T12:00:00Z')
    assert.equal(period.start.toISOString(), '2026-03-15T00:00:00.000Z')
    assert.equal(period.end.toISOString(), '2026-04-15T00:00:00.000Z')
  })

  it('в день подключения открывает первый период', () => {
    const period = currentPeriod('2026-01-15T00:00:00Z', '2026-01-15T00:00:00Z')
    assert.equal(period.start.toISOString(), '2026-01-15T00:00:00.000Z')
    assert.equal(period.end.toISOString(), '2026-02-15T00:00:00.000Z')
  })

  it('накануне следующего периода не перескакивает', () => {
    const period = currentPeriod('2026-01-15T00:00:00Z', '2026-02-14T23:59:00Z')
    assert.equal(period.start.toISOString(), '2026-01-15T00:00:00.000Z')
  })

  it('переживает 31-е число', () => {
    const period = currentPeriod('2026-01-31T00:00:00Z', '2026-02-28T12:00:00Z')
    assert.equal(period.start.toISOString(), '2026-02-28T00:00:00.000Z')
    assert.equal(period.end.toISOString(), '2026-03-31T00:00:00.000Z')
  })
})

describe('usageSummary', () => {
  it('не начисляет сверхпакет и не режет по лимиту', () => {
    const usage = usageSummary('start', 640)
    assert.equal(usage.links, 640)
    assert.equal(usage.unlimited, true)
    assert.equal(usage.included, null)
    assert.equal(usage.overage, 0)
    assert.equal(usage.overageCost, 0)
    assert.equal(usage.total, 11900)
  })

  it('неизвестный и устаревший тариф приводит к каталогу', () => {
    assert.equal(usageSummary('nope', 0).base, planById('start').price)
    assert.equal(usageSummary('flow', 10).base, planById('pro').price)
    assert.equal(usageSummary('max', 10).base, planById('pro').price)
  })
})

describe('catalog', () => {
  it('два тарифа: Старт V1 и Про V2', () => {
    assert.deepEqual(
      PLANS.map((plan) => ({ id: plan.id, constructor: plan.constructor, price: plan.price })),
      [
        { id: 'start', constructor: 'v1', price: 11900 },
        { id: 'pro', constructor: 'v2', price: 29900 },
      ],
    )
  })

  it('нормализует старые id', () => {
    assert.equal(normalizePlanId('flow'), 'pro')
    assert.equal(normalizePlanId('max'), 'pro')
    assert.equal(normalizePlanId('start'), 'start')
  })

  it('повышение — по цене продукта', () => {
    assert.equal(isPlanUpgrade('start', 'pro'), true)
    assert.equal(isPlanUpgrade('pro', 'start'), false)
  })
})
