import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  transcribeAttachmentState,
  transcribeStageDescription,
  waitingLineAt,
  WAITING_LINES,
} from './useTranscribeProgress.ts'

describe('transcribeStageDescription', () => {
  it('идёт по сюжету портала, а сохранение только в конце', () => {
    assert.equal(transcribeStageDescription('request'), 'Открываю портал')
    assert.equal(transcribeStageDescription('download'), 'Скачиваю звонок')
    assert.equal(transcribeStageDescription('send'), 'Отправляю на сервер')
    assert.equal(transcribeStageDescription('model'), 'Подключаю LLM ')
    assert.equal(transcribeStageDescription('waiting', 0), 'Жду ответ')
    assert.equal(transcribeStageDescription('saving'), 'Сохраняю результат')
  })

  it('крутит смешные фразы ожидания', () => {
    assert.equal(waitingLineAt(0), WAITING_LINES[0])
    assert.equal(waitingLineAt(WAITING_LINES.length), WAITING_LINES[0])
    assert.match(transcribeStageDescription('waiting', 8), /кофе|токен|мычание|угу|алло/i)
  })
})

describe('transcribeAttachmentState', () => {
  it('переключает uploading и processing', () => {
    assert.equal(transcribeAttachmentState('request'), 'uploading')
    assert.equal(transcribeAttachmentState('download'), 'uploading')
    assert.equal(transcribeAttachmentState('send'), 'processing')
    assert.equal(transcribeAttachmentState('model'), 'processing')
    assert.equal(transcribeAttachmentState('waiting'), 'processing')
    assert.equal(transcribeAttachmentState('saving'), 'processing')
  })
})
