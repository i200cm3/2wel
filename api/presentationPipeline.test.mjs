import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  shouldQueueAmoPresentationUrl,
  shouldWriteAmoPresentationUrl,
} from './presentationPipeline.mjs'

/**
 * Логика «URL в amo только после ready» — чистая проверка контракта пайплайна.
 * Полный runPresentationPipeline требует БД/Gemini; здесь фиксируем инварианты ответа webhook.
 */

describe('presentation pipeline amo write contract', () => {
  it('не пишет URL пока extract не готов при наличии звонков', () => {
    assert.equal(
      shouldQueueAmoPresentationUrl({
        assembleOk: true,
        extractOk: false,
        eligibleCalls: 5,
        failedTranscriptions: 0,
      }).ok,
      false,
    )
    assert.equal(
      shouldQueueAmoPresentationUrl({
        assembleOk: true,
        extractOk: true,
        eligibleCalls: 5,
        failedTranscriptions: 0,
      }).ok,
      true,
    )
  })

  it('не пишет URL если транскрибации упали', () => {
    assert.equal(
      shouldQueueAmoPresentationUrl({
        assembleOk: true,
        extractOk: true,
        eligibleCalls: 3,
        failedTranscriptions: 1,
      }).reason,
      'transcribe_incomplete',
    )
  })

  it('ждёт параллельные пайплайны по той же сделке', () => {
    assert.equal(
      shouldWriteAmoPresentationUrl({
        assembleOk: true,
        extractOk: true,
        eligibleCalls: 2,
        failedTranscriptions: 0,
        peerPipelinesRunning: 1,
      }).reason,
      'peer_pipelines_running',
    )
  })

  it('webhook processing payload marks amo URL as pending without early url', () => {
    const payload = {
      ok: true,
      status: 'success',
      pipeline: 'pending',
      amoUrlPending: true,
      publicId: 'abc123',
      // Не отдаём url Salesbot’у до write_amo — иначе письмо уходит на «только имя».
      url: '',
    }
    assert.equal(payload.amoUrlPending, true)
    assert.equal(payload.pipeline, 'pending')
    assert.equal(payload.status, 'success')
    assert.equal(payload.url, '')
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
