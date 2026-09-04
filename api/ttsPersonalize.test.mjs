import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ttsCacheKey, ttsCacheKeyParts } from './tts.mjs'
import {
  applyCaptionsFromTts,
  collectPersonalizedTtsJobs,
  extendCueDuration,
  fillTtsSpeakText,
  ttsTextNeedsGuestName,
} from './ttsPersonalize.mjs'

describe('ttsTextNeedsGuestName', () => {
  it('ловит {name} и [name]', () => {
    assert.equal(ttsTextNeedsGuestName('Здравствуйте, {name}!'), true)
    assert.equal(ttsTextNeedsGuestName('Привет, [name]'), true)
    assert.equal(ttsTextNeedsGuestName('Здравствуйте, {NAME}!'), true)
    assert.equal(ttsTextNeedsGuestName('Здравствуйте, { name }!'), true)
    assert.equal(ttsTextNeedsGuestName('Без плейсхолдера'), false)
    assert.equal(ttsTextNeedsGuestName(''), false)
    assert.equal(ttsTextNeedsGuestName(undefined), false)
  })
})

describe('fillTtsSpeakText', () => {
  it('подставляет имя с заглавной буквы', () => {
    assert.equal(fillTtsSpeakText('Здравствуйте, {name}!', 'виталий'), 'Здравствуйте, Виталий!')
    assert.equal(fillTtsSpeakText('Hi, [name]', 'анна'), 'Hi, Анна')
  })
})

describe('collectPersonalizedTtsJobs', () => {
  it('собирает только cue с {name} в ttsText', () => {
    const jobs = collectPersonalizedTtsJobs(
      {
        sequences: {
          greeting: {
            cues: [
              { id: 'c1', ttsText: 'Здравствуйте, {name}!' },
              { id: 'c2', ttsText: 'Без имени' },
              { id: 'c3', text: 'Титр с {name}', ttsText: '' },
            ],
          },
        },
      },
      'иван',
    )
    assert.equal(jobs.length, 1)
    assert.equal(jobs[0].cueId, 'c1')
    assert.equal(jobs[0].speak, 'Здравствуйте, Иван!')
  })
})

describe('ttsCacheKey · голос в хеше', () => {
  it('один текст с разными voice id даёт разный hash', () => {
    const text = 'Здравствуйте, Иван!'
    const a = ttsCacheKey(ttsCacheKeyParts(text, { provider: 'sber', voice: 'Bys_24000' }))
    const b = ttsCacheKey(ttsCacheKeyParts(text, { provider: 'sber', voice: 'Nec_24000' }))
    assert.notEqual(a, b)
    assert.equal(
      ttsCacheKey(ttsCacheKeyParts(text, { provider: 'sber', voice: 'Bys_24000' })),
      a,
    )
  })
})

describe('applyCaptionsFromTts', () => {
  it('подставляет ttsText в титр и включает показ', () => {
    const config = {
      sequences: {
        greeting: {
          cues: [
            { id: 'c1', text: 'Короткий', ttsText: 'Здравствуйте, {name}!', showText: false },
            { id: 'c2', text: 'Без озвучки' },
            { id: 'c3', text: 'Есть', ttsText: '   ' },
          ],
        },
      },
    }
    const next = applyCaptionsFromTts(config)
    assert.notEqual(next, config)
    assert.equal(next.sequences.greeting.cues[0].text, 'Здравствуйте, {name}!')
    assert.equal(next.sequences.greeting.cues[0].showText, true)
    assert.equal(next.sequences.greeting.cues[1].text, 'Без озвучки')
    assert.equal(next.sequences.greeting.cues[2].text, 'Есть')
    assert.equal(config.sequences.greeting.cues[0].text, 'Короткий')
  })

  it('не трогает конфиг без ttsText', () => {
    const config = { sequences: { a: { cues: [{ id: 'c1', text: 'Титр' }] } } }
    assert.equal(applyCaptionsFromTts(config), config)
  })
})

describe('extendCueDuration', () => {
  it('сдвигает следующие cue и удлиняет кадр', () => {
    const seq = {
      cues: [
        { id: 'a', startSec: 0, durationSec: 5 },
        { id: 'b', startSec: 5, durationSec: 4 },
        { id: 'c', startSec: 9, durationSec: 3 },
      ],
      clips: [
        { id: 'clip-a', durationSec: 5, animSec: 5 },
        { id: 'clip-b', durationSec: 4, animSec: 4 },
      ],
    }
    extendCueDuration(seq, 0, 7.5)
    assert.equal(seq.cues[0].durationSec, 7.5)
    assert.equal(seq.cues[1].startSec, 7.5)
    assert.equal(seq.cues[2].startSec, 11.5)
    assert.equal(seq.clips[0].durationSec, 7.5)
    assert.equal(seq.clips[0].animSec, 7.5)
    assert.equal(seq.clips[1].durationSec, 4)
  })
})
