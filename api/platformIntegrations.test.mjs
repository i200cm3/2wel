import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  maskApiKey,
  maskFolderId,
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

describe('maskFolderId', () => {
  it('маскирует folder id', () => {
    assert.equal(maskFolderId('b1gabcdefghijk'), 'b1g…ijk')
  })

  it('пустой → null', () => {
    assert.equal(maskFolderId(''), null)
  })
})

describe('testAdminIntegration', () => {
  it('отклоняет неизвестный провайдер', async () => {
    const { testAdminIntegration } = await import('./platformIntegrations.mjs')
    const out = await testAdminIntegration('nope')
    assert.equal(out.ok, false)
    assert.equal(out.status, 400)
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
  it('принимает yandex и local; gemini сводит к yandex', async () => {
    const { normalizeAssemblyProvider } = await import('./platformIntegrations.mjs')
    assert.equal(normalizeAssemblyProvider('yandex'), 'yandex')
    assert.equal(normalizeAssemblyProvider('Gemini'), 'yandex')
    assert.equal(normalizeAssemblyProvider(''), 'yandex')
    assert.equal(normalizeAssemblyProvider('local'), 'local')
    assert.equal(normalizeAssemblyProvider('ollama'), 'local')
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
  it('yandex и local доступны для экстракта, gemini в выборе нет', async () => {
    const { ASSEMBLY_PROVIDERS } = await import('./platformIntegrations.mjs')
    assert.equal(ASSEMBLY_PROVIDERS.some((item) => item.id === 'gemini'), false)
    assert.equal(ASSEMBLY_PROVIDERS.find((item) => item.id === 'yandex')?.available, true)
    assert.equal(ASSEMBLY_PROVIDERS.find((item) => item.id === 'local')?.available, true)
    assert.equal(ASSEMBLY_PROVIDERS.find((item) => item.id === 'local')?.label, 'Qwen')
  })
})
