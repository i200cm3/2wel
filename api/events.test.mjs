import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { addCalendarDays, parseDay, parseTopic, resolveLinkStatsRange, resolveStatsRange, topicLabelsFromConfig } from './events.mjs'

describe('resolveStatsRange', () => {
  const now = new Date('2026-08-15T12:00:00+03:00')

  it('по умолчанию последние 14 дней по Москве', () => {
    assert.deepEqual(resolveStatsRange({}, now), { from: '2026-08-02', to: '2026-08-15' })
  })

  it('принимает from/to', () => {
    assert.deepEqual(resolveStatsRange({ from: '2026-08-01', to: '2026-08-10' }, now), {
      from: '2026-08-01',
      to: '2026-08-10',
    })
  })

  it('меняет местами перевёрнутый диапазон', () => {
    assert.deepEqual(resolveStatsRange({ from: '2026-08-10', to: '2026-08-01' }, now), {
      from: '2026-08-01',
      to: '2026-08-10',
    })
  })

  it('обрезает конец сегодняшним днём', () => {
    assert.deepEqual(resolveStatsRange({ from: '2026-08-01', to: '2026-08-20' }, now), {
      from: '2026-08-01',
      to: '2026-08-15',
    })
  })

  it('отбрасывает несуществующие даты', () => {
    assert.equal(parseDay('2026-02-30'), null)
    assert.deepEqual(resolveStatsRange({ from: 'нет', to: 'даты' }, now), {
      from: '2026-08-02',
      to: '2026-08-15',
    })
  })

  it('сдвигает дни без пропусков', () => {
    assert.equal(addCalendarDays('2026-03-01', -1), '2026-02-28')
    assert.equal(addCalendarDays('2026-12-31', 1), '2027-01-01')
  })
})

describe('resolveLinkStatsRange', () => {
  const now = new Date('2026-08-15T12:00:00+03:00')

  it('по умолчанию от даты выдачи до сегодня', () => {
    assert.deepEqual(resolveLinkStatsRange('2026-08-10T10:00:00Z', {}, now), {
      from: '2026-08-10',
      to: '2026-08-15',
    })
  })

  it('не начинает раньше даты выдачи при явном from', () => {
    assert.deepEqual(resolveLinkStatsRange('2026-08-10T10:00:00Z', { from: '2026-08-01', to: '2026-08-15' }, now), {
      from: '2026-08-10',
      to: '2026-08-15',
    })
  })
})

describe('parseTopic', () => {
  it('принимает id блока', () => {
    assert.equal(parseTopic('treatment'), 'treatment')
    assert.equal(parseTopic('seq-x7k2m9q'), 'seq-x7k2m9q')
  })

  it('отбрасывает пустое и мусор', () => {
    assert.equal(parseTopic(''), null)
    assert.equal(parseTopic('a/b'), null)
    assert.equal(parseTopic('x'.repeat(65)), null)
  })
})

describe('topicLabelsFromConfig', () => {
  it('берёт подпись из меню, а не служебное имя блока', () => {
    const labels = topicLabelsFromConfig({
      sequences: { rooms: { label: 'Номера внутри' } },
      menus: {
        main: {
          branches: [{ sequenceId: 'rooms', label: 'Размещение' }],
        },
      },
    })
    assert.equal(labels.rooms, 'Размещение')
  })
})
