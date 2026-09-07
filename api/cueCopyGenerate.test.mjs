import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildCueCopyPrompt,
  parseCueCopyResponse,
} from './cueCopyGenerate.mjs'

const sampleInput = {
  brand: {
    name: 'Плаза',
    fullName: 'Санаторий «Плаза СПА»',
    city: 'Кисловодск',
    site: 'https://kislovodsk.plaza.spa/',
  },
  copyFacts: '5★ комплекс, бассейн, сауна.',
  block: {
    label: 'Лечение',
    group: 'treatment',
    subgroup: 'generic',
    audienceTags: ['couple'],
    topicTags: ['treatment'],
    objectionTags: ['expensive'],
    slotFields: ['name'],
    title: 'Лечение с врачом',
    cues: [
      { text: 'Программы под наблюдением', ttsText: 'Программы подбирает врач.' },
      { text: '', ttsText: '' },
      { text: 'Профили лечения', ttsText: 'Есть профили по сердцу и спине.' },
    ],
  },
  cueIndex: 1,
  updateTitle: false,
}

test('buildCueCopyPrompt fills context and previous/later cues', () => {
  const built = buildCueCopyPrompt(sampleInput)
  assert.equal(built.ok, true)
  assert.match(built.prompt, /Санаторий «Плаза СПА»/)
  assert.match(built.prompt, /5★ комплекс/)
  assert.match(built.prompt, /генерируем № 2/)
  assert.match(built.prompt, /Обновлять title: нет/)
  assert.match(built.prompt, /Программы под наблюдением/)
  assert.match(built.prompt, /Профили лечения/)
  assert.match(built.prompt, /Пара/)
  assert.match(built.prompt, /Лечение/)
  assert.match(built.prompt, /Дорого/)
})

test('buildCueCopyPrompt rejects bad cueIndex', () => {
  const built = buildCueCopyPrompt({ ...sampleInput, cueIndex: 9 })
  assert.equal(built.ok, false)
})

test('parseCueCopyResponse reads json and keeps title when not updating', () => {
  const parsed = parseCueCopyResponse(
    '```json\n{"title":"Новый","cue":{"text":"Титр","ttsText":"Озвучка"}}\n```',
    { updateTitle: false, fallbackTitle: 'Старый' },
  )
  assert.equal(parsed.ok, true)
  assert.equal(parsed.title, 'Старый')
  assert.equal(parsed.cue.text, 'Титр')
  assert.equal(parsed.cue.ttsText, 'Озвучка')
})

test('parseCueCopyResponse updates title when asked', () => {
  const parsed = parseCueCopyResponse(
    '{"title":"Новый заголовок","cue":{"text":"А","ttsText":"Б"}}',
    { updateTitle: true, fallbackTitle: 'Старый' },
  )
  assert.equal(parsed.ok, true)
  assert.equal(parsed.title, 'Новый заголовок')
})
