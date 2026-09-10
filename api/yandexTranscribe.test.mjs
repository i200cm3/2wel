import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { describe, it } from 'node:test'
import {
  mergeYandexStereoTranscript,
  mergeYandexStereoTurns,
  prepareYandexSyncAudio,
  speechRegionsFromSilenceLog,
} from './geminiTranscribe.mjs'

function hasFfmpeg() {
  const probe = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' })
  return probe.status === 0
}

describe('speechRegionsFromSilenceLog', () => {
  it('строит речь между паузами', () => {
    const log = `
silence_start: 1.0
silence_end: 1.5
silence_start: 3.0
silence_end: 3.2
`
    const regions = speechRegionsFromSilenceLog(log, 5)
    assert.deepEqual(regions, [
      { start: 0, end: 1 },
      { start: 1.5, end: 3 },
      { start: 3.2, end: 5 },
    ])
  })
})

describe('mergeYandexStereoTurns', () => {
  it('сортирует по времени и склеивает соседние одной роли', () => {
    const text = mergeYandexStereoTurns(
      [
        { channel: 'left', text: 'Алло' },
        { channel: 'right', text: 'Здравствуйте' },
        { channel: 'right', text: 'чем помочь' },
        { channel: 'left', text: 'Хочу бронь' },
      ],
      ['Клиент', 'Оператор'],
    )
    assert.equal(
      text,
      ['Клиент: Алло', 'Оператор: Здравствуйте чем помочь', 'Клиент: Хочу бронь'].join('\n'),
    )
  })
})

describe('mergeYandexStereoTranscript', () => {
  it('по умолчанию L=Клиент R=Оператор', () => {
    const text = mergeYandexStereoTranscript([{ a: 'привет', b: 'слушаю' }])
    assert.equal(text, 'Клиент: привет\nОператор: слушаю')
  })
})

describe('prepareYandexSyncAudio', () => {
  it('конвертирует mp3 в oggopus для sync STT', async (t) => {
    if (!hasFfmpeg()) {
      t.skip('ffmpeg недоступен')
      return
    }

    const gen = spawnSync(
      'ffmpeg',
      [
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:duration=1',
        '-ac',
        '1',
        '-codec:a',
        'libmp3lame',
        '-f',
        'mp3',
        'pipe:1',
      ],
      { encoding: 'buffer', maxBuffer: 2 * 1024 * 1024 },
    )
    assert.equal(gen.status, 0, gen.stderr?.toString?.() || 'ffmpeg mp3 failed')
    assert.ok(gen.stdout?.length > 100)

    const prepared = await prepareYandexSyncAudio(gen.stdout, 'audio/mpeg')
    assert.equal(prepared.ok, true, prepared.error || 'prepare failed')
    assert.equal(prepared.format, 'oggopus')
    assert.equal(prepared.chunks.length, 1)
    assert.ok(prepared.chunks[0].buffer.length > 50)
    assert.equal(prepared.chunks[0].buffer.subarray(0, 4).toString('ascii'), 'OggS')
  })

  it('стерео: режет реплики по каналам и времени', async (t) => {
    if (!hasFfmpeg()) {
      t.skip('ffmpeg недоступен')
      return
    }

    // L: тон 0–1с и 2.5–3.5с; R: тон 1.2–2.2с — три реплики по времени
    const gen = spawnSync(
      'ffmpeg',
      [
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:duration=4',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=880:duration=4',
        '-filter_complex',
        [
          '[0:a]volume=enable=\'between(t,0,1)+between(t,2.5,3.5)\':volume=1[l]',
          '[1:a]volume=enable=\'between(t,1.2,2.2)\':volume=1[r]',
          '[l][r]join=inputs=2:channel_layout=stereo[a]',
        ].join(';'),
        '-map',
        '[a]',
        '-codec:a',
        'libmp3lame',
        '-f',
        'mp3',
        'pipe:1',
      ],
      { encoding: 'buffer', maxBuffer: 4 * 1024 * 1024 },
    )
    assert.equal(gen.status, 0, gen.stderr?.toString?.() || 'ffmpeg stereo failed')

    const prepared = await prepareYandexSyncAudio(gen.stdout, 'audio/mpeg')
    assert.equal(prepared.ok, true, prepared.error || 'prepare failed')
    assert.equal(prepared.stereo, true)
    assert.deepEqual(prepared.labels, ['Клиент', 'Оператор'])
    if (prepared.mode === 'turns') {
      assert.ok(prepared.turns.length >= 2, `expected turns, got ${prepared.turns.length}`)
      const channels = prepared.turns.map((t) => t.channel)
      assert.ok(channels.includes('left'))
      assert.ok(channels.includes('right'))
      for (let i = 1; i < prepared.turns.length; i++) {
        assert.ok(prepared.turns[i].start >= prepared.turns[i - 1].start - 0.05)
      }
    } else {
      assert.ok(prepared.leftChunks?.length >= 1)
      assert.ok(prepared.rightChunks?.length >= 1)
    }
  })
})
