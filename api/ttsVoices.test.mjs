import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ELEVENLABS_VOICE_DEMO_TEXT, elevenDemoSrc } from './ttsVoiceDemo.mjs'
import { SBER_VOICES, defaultProvider, elevenConfigured, isElevenVoiceId, normalizeSelection, parseElevenVoicesEnv, resolveElevenVoice, sortCabinetVoices, sberDemoSrc, voiceCatalog } from './ttsVoices.mjs'

describe('каталог голосов Сбера', () => {
  it('содержит коды из документации SaluteSpeech', () => {
    const ids = SBER_VOICES.map((voice) => voice.id)
    for (const id of ['Nec_24000', 'Bys_24000', 'May_24000', 'Tur_24000', 'Ost_24000', 'Pon_24000']) {
      assert.ok(ids.includes(id), `нет голоса ${id}`)
    }
  })

  it('провайдер по умолчанию из TTS_PROVIDER', () => {
    assert.ok(['sber', 'elevenlabs'].includes(defaultProvider()))
  })

  it('Сбер скрыт в каталоге, если настроен ElevenLabs', () => {
    if (elevenConfigured()) {
      assert.ok(!voiceCatalog().some((item) => item.id === 'sber'))
      assert.equal(voiceCatalog()[0].id, 'elevenlabs')
    } else {
      assert.ok(voiceCatalog().some((item) => item.id === 'sber'))
    }
  })

  it('отдаёт официальные демо 24 кГц для кабинета', () => {
    assert.match(sberDemoSrc('Nec_24000'), /natasha-hq\.mp3$/)
    const catalog = SBER_VOICES.find((voice) => voice.id === 'Bys_24000')
    assert.ok(catalog?.demoSrc?.includes('boris-hq.mp3'))
    assert.equal(SBER_VOICES.find((voice) => voice.id === 'Nec_8000')?.demoSrc, '')
  })
})

describe('sortCabinetVoices', () => {
  it('сначала доступные, затем пол, затем имя', () => {
    const sorted = sortCabinetVoices([
      { id: 'b', name: 'George (тёплый, мужской)', label: 'George (тёплый, мужской)', demoSrc: '/a.mp3' },
      { id: 'c', name: 'Marina (тёплый, женский)', label: 'Marina (тёплый, женский)' },
      { id: 'a', name: 'Sarah (мягкий, женский)', label: 'Sarah (мягкий, женский)', demoSrc: '/b.mp3' },
      { id: 'd', name: 'Adam (солидный, мужской)', label: 'Adam (солидный, мужской)', demoSrc: '/c.mp3' },
    ])
    assert.deepEqual(
      sorted.map((item) => item.id),
      ['a', 'd', 'b', 'c'],
    )
    assert.equal(sorted[0].available, true)
    assert.equal(sorted[3].available, false)
  })
})

describe('parseElevenVoicesEnv', () => {
  it('не режет имя по запятой внутри скобок', () => {
    const parsed = parseElevenVoicesEnv(
      'ymDCYd8puC7gYjxIamPt|Marina (тёплый, женский),EXAVITQu4vr4xnSDxMaL|Sarah (мягкий, женский),JBFqnCBsd6RMkjVDRZzb|George (тёплый, мужской)',
    )
    assert.equal(parsed.length, 3)
    assert.equal(parsed[0].name, 'Marina (тёплый, женский)')
    assert.equal(parsed[1].name, 'Sarah (мягкий, женский)')
    assert.equal(parsed[2].name, 'George (тёплый, мужской)')
  })
})

describe('демо ElevenLabs', () => {
  it('хранит фразу и путь к mp3', () => {
    assert.match(ELEVENLABS_VOICE_DEMO_TEXT, /персональную презентацию/)
    assert.equal(elevenDemoSrc('ymDCYd8puC7gYjxIamPt'), '/media/tts/demos/elevenlabs/ymDCYd8puC7gYjxIamPt.mp3')
    assert.equal(elevenDemoSrc('../evil'), '')
  })
})

describe('normalizeSelection', () => {
  it('принимает голос Сбера', () => {
    assert.deepEqual(normalizeSelection('sber', 'Bys_24000'), {
      ok: true,
      provider: 'sber',
      voice: 'Bys_24000',
    })
  })

  it('отклоняет неизвестный голос и сервис', () => {
    assert.equal(normalizeSelection('sber', 'Nope_24000').ok, false)
    assert.equal(normalizeSelection('yandex', 'Nec_24000').ok, false)
  })

  it('без голоса подставляет дефолтный', () => {
    const result = normalizeSelection('sber', '')
    assert.equal(result.ok, true)
    assert.ok(SBER_VOICES.some((voice) => voice.id === result.voice))
  })

  it('отклоняет мусорный id ElevenLabs', () => {
    assert.equal(normalizeSelection('elevenlabs', 'женский)').ok, false)
    assert.equal(isElevenVoiceId('женский)'), false)
    assert.equal(isElevenVoiceId('ymDCYd8puC7gYjxIamPt'), true)
  })

  it('находит ElevenLabs по подписи, а не только по id', () => {
    const voices = [
      { id: 'ymDCYd8puC7gYjxIamPt', name: 'Marina (тёплый, женский)', label: 'Marina (тёплый, женский)' },
    ]
    assert.equal(resolveElevenVoice('Marina (тёплый, женский)', voices), 'ymDCYd8puC7gYjxIamPt')
    assert.equal(resolveElevenVoice('ymDCYd8puC7gYjxIamPt', voices), 'ymDCYd8puC7gYjxIamPt')
  })

  it('не принимает код голоса Сбера как ElevenLabs', () => {
    assert.equal(normalizeSelection('elevenlabs', 'Nec_24000').ok, false)
  })
})
