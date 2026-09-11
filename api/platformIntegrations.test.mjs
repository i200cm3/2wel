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
  it('всегда gigaam', () => {
    assert.equal(normalizeTranscribeProvider('gemini'), 'gigaam')
    assert.equal(normalizeTranscribeProvider('Yandex'), 'gigaam')
    assert.equal(normalizeTranscribeProvider(''), 'gigaam')
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
  it('единственный провайдер — GigaAM', () => {
    assert.equal(TRANSCRIBE_PROVIDERS.length, 1)
    assert.equal(TRANSCRIBE_PROVIDERS[0]?.id, 'gigaam')
    assert.equal(TRANSCRIBE_PROVIDERS[0]?.available, true)
  })
})

describe('ASSEMBLY_PROVIDERS', () => {
  it('gemini и yandex доступны для сборки', async () => {
    const { ASSEMBLY_PROVIDERS } = await import('./platformIntegrations.mjs')
    assert.equal(ASSEMBLY_PROVIDERS.find((item) => item.id === 'gemini')?.available, true)
    assert.equal(ASSEMBLY_PROVIDERS.find((item) => item.id === 'yandex')?.available, true)
  })
})
