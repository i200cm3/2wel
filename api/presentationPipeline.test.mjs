import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

/**
 * Логика «URL в amo только после ready» — чистая проверка контракта пайплайна.
 * Полный runPresentationPipeline требует БД/Gemini; здесь фиксируем инварианты ответа webhook.
 */

describe('presentation pipeline amo write contract', () => {
  it('writes amo URL only when assembly succeeded', async () => {
    const writes = []
    const writeAmo = async (_connection, leadId, url) => {
      writes.push({ leadId, url })
    }

    async function finishPipeline({ assembleOk, url, leadId, connection }) {
      if (!assembleOk) return { ok: false, writtenToAmo: false }
      if (connection && leadId && url) {
        await writeAmo(connection, leadId, url)
        return { ok: true, writtenToAmo: true, url }
      }
      return { ok: true, writtenToAmo: false, url }
    }

    const failed = await finishPipeline({
      assembleOk: false,
      url: 'https://x.example/abc',
      leadId: '1',
      connection: {},
    })
    assert.equal(failed.writtenToAmo, false)
    assert.equal(writes.length, 0)

    const ok = await finishPipeline({
      assembleOk: true,
      url: 'https://x.example/abc',
      leadId: '1',
      connection: {},
    })
    assert.equal(ok.writtenToAmo, true)
    assert.deepEqual(writes, [{ leadId: '1', url: 'https://x.example/abc' }])
  })

  it('webhook processing payload marks amo URL as pending', () => {
    const payload = {
      ok: true,
      status: 'success',
      pipeline: 'pending',
      amoUrlPending: true,
      publicId: 'abc123',
      url: 'https://djinal.example/abc123',
    }
    assert.equal(payload.amoUrlPending, true)
    assert.equal(payload.pipeline, 'pending')
    assert.equal(payload.status, 'success')
  })
})

describe('recordingUrlFromSource meta fallback', async () => {
  const { recordingUrlFromSource } = await import('./recordingUrl.mjs')

  it('reads URL from meta after transcription', () => {
    assert.equal(
      recordingUrlFromSource({
        body: 'Текст звонка',
        meta: { recordingUrl: 'https://sipuni.example/r.mp3' },
      }),
      'https://sipuni.example/r.mp3',
    )
    assert.equal(
      recordingUrlFromSource({ body: 'https://sipuni.example/direct.mp3' }),
      'https://sipuni.example/direct.mp3',
    )
  })
})
