import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  maskApiKey,
  normalizeTranscribeProvider,
  TRANSCRIBE_PROVIDERS,
} from './platformIntegrations.mjs'

describe('maskApiKey', () => {
  it('маскирует длинный ключ', () => {
    assert.equal(maskApiKey('AIzaSyABCDEFGH1234567890xyz'), 'AIza…0xyz')
  })

  it('для короткого ключа отдаёт точки', () => {
    assert.equal(maskApiKey('short'), '••••••••')
  })

  it('пустой ключ → null', () => {
    assert.equal(maskApiKey(''), null)
    assert.equal(maskApiKey(null), null)
  })
})

describe('normalizeTranscribeProvider', () => {
  it('принимает gemini и yandex', () => {
    assert.equal(normalizeTranscribeProvider('gemini'), 'gemini')
    assert.equal(normalizeTranscribeProvider('Yandex'), 'yandex')
  })

  it('неизвестный → gemini', () => {
    assert.equal(normalizeTranscribeProvider('whisper'), 'gemini')
    assert.equal(normalizeTranscribeProvider(''), 'gemini')
  })
})

describe('normalizeAssemblyProvider', () => {
  it('принимает gemini и yandex', async () => {
    const { normalizeAssemblyProvider } = await import('./platformIntegrations.mjs')
    assert.equal(normalizeAssemblyProvider('yandex'), 'yandex')
    assert.equal(normalizeAssemblyProvider('Gemini'), 'gemini')
    assert.equal(normalizeAssemblyProvider(''), 'gemini')
  })
})

describe('TRANSCRIBE_PROVIDERS', () => {
  it('gemini и yandex доступны', () => {
    const gemini = TRANSCRIBE_PROVIDERS.find((item) => item.id === 'gemini')
    const yandex = TRANSCRIBE_PROVIDERS.find((item) => item.id === 'yandex')
    assert.equal(gemini?.available, true)
    assert.equal(yandex?.available, true)
  })
})

describe('ASSEMBLY_PROVIDERS', () => {
  it('gemini и yandex доступны для сборки', async () => {
    const { ASSEMBLY_PROVIDERS } = await import('./platformIntegrations.mjs')
    assert.equal(ASSEMBLY_PROVIDERS.find((item) => item.id === 'gemini')?.available, true)
    assert.equal(ASSEMBLY_PROVIDERS.find((item) => item.id === 'yandex')?.available, true)
  })
})
