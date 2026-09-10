import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  applyHelloPlaceholderInConfig,
  DEFAULT_HELLO_TEMPLATE,
  fillHelloPlaceholder,
  generateHelloFromDialog,
  parseHelloGenerateResponse,
  textHasHelloPlaceholder,
} from './helloGenerate.mjs'

describe('fillHelloPlaceholder', () => {
  it('подставляет фразу и умеет опустошать слот', () => {
    assert.equal(fillHelloPlaceholder('{hello}', 'Сергей, здравствуйте.'), 'Сергей, здравствуйте.')
    assert.equal(fillHelloPlaceholder('{hello}', ''), '')
    assert.equal(fillHelloPlaceholder('До: {hello}!', 'привет'), 'До: привет!')
  })
})

describe('parseHelloGenerateResponse', () => {
  it('читает personal', () => {
    const parsed = parseHelloGenerateResponse(
      '{"mode":"personal","hello":"Сергей, здравствуйте. Ещё раз коротко расскажем о санатории."}',
    )
    assert.equal(parsed.ok, true)
    assert.equal(parsed.mode, 'personal')
    assert.match(parsed.hello, /Сергей/)
  })

  it('без mode считает default', () => {
    const parsed = parseHelloGenerateResponse(`\`\`\`json\n{"hello":"${DEFAULT_HELLO_TEMPLATE}"}\n\`\`\``)
    assert.equal(parsed.ok, true)
    assert.equal(parsed.mode, 'default')
  })

  it('отбрасывает вложенный {hello}', () => {
    const parsed = parseHelloGenerateResponse('{"mode":"personal","hello":"Привет {hello}"}')
    assert.equal(parsed.ok, true)
    assert.equal(parsed.hello, 'Привет')
  })
})

describe('generateHelloFromDialog', () => {
  it('выключенная настройка даёт пустой hello', async () => {
    const result = await generateHelloFromDialog({
      enabled: false,
      rawText: 'Клиент: можно с собакой?',
      guestName: 'Сергей',
    })
    assert.equal(result.mode, 'off')
    assert.equal(result.hello, '')
  })
})

describe('applyHelloPlaceholderInConfig', () => {
  it('подставляет в title, титр и TTS', () => {
    const config = {
      sequences: {
        intro: {
          title: '{hello}',
          cues: [{ id: 'c1', text: '{hello}', ttsText: '{hello}' }],
        },
      },
    }
    applyHelloPlaceholderInConfig(config, 'Анна, здравствуйте.')
    assert.equal(config.sequences.intro.title, 'Анна, здравствуйте.')
    assert.equal(config.sequences.intro.cues[0].ttsText, 'Анна, здравствуйте.')
    assert.equal(textHasHelloPlaceholder(config.sequences.intro.cues[0].text), false)
  })
})
