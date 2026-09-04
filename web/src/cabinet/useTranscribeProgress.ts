import { useEffect, useState } from 'react'
import { estimateTranscribeSec } from './linkRawSourceKinds.ts'

export const DEFAULT_TRANSCRIBE_MODEL = 'gemini-3.5-flash'
export const TRANSCRIBE_SAVE_HOLD_MS = 700
export const WAITING_LINE_INTERVAL_MS = 2_800

export type TranscribeProgressStage = 'request' | 'download' | 'send' | 'model' | 'waiting' | 'saving'

const STAGE_THRESHOLDS = [
  { stage: 'request' as const, until: 0.07 },
  { stage: 'download' as const, until: 0.18 },
  { stage: 'send' as const, until: 0.28 },
  { stage: 'model' as const, until: 0.38 },
  { stage: 'waiting' as const, until: 1 },
]

/** Фейковый прогресс не доходит до 100%: после капа всё ещё ждём ответ модели. */
const FAKE_PROGRESS_CAP = 0.9

export const WAITING_LINES = [
  'Жду ответ',
  'Считаю «эээ» и «ну вот»',
  'Ищу, кто говорил первым',
  'Перевожу мычание в текст',
  'Прошу модель не додумывать',
  'Разбираю «алло, меня слышно?»',
  'Отделяю гудки от смысла',
  'Ловлю смысл между «угу»',
  'Наливаю модели виртуальный кофе',
  'Склеиваю обрывки фраз',
  'Жду, пока токены дойдут',
  'Нейросеть думает чуть громче',
  'Проверяю, был ли это вообще разговор',
]

export function waitingLineAt(index: number) {
  const i = ((index % WAITING_LINES.length) + WAITING_LINES.length) % WAITING_LINES.length
  return WAITING_LINES[i]
}

export function transcribeStageDescription(
  stage: TranscribeProgressStage,
  waitingIndex = 0,
): string {
  switch (stage) {
    case 'request':
      return 'Открываю портал'
    case 'download':
      return 'Скачиваю звонок'
    case 'send':
      return 'Отправляю на сервер'
    case 'model':
      return 'Подключаю LLM '
    case 'waiting':
      return waitingLineAt(waitingIndex)
    case 'saving':
      return 'Сохраняю результат'
  }
}

export function transcribeAttachmentState(stage: TranscribeProgressStage) {
  return stage === 'request' || stage === 'download' ? 'uploading' : 'processing'
}

export function useTranscribeProgress(
  active: boolean,
  audioDurationSec: number | null,
  complete = false,
) {
  const [stage, setStage] = useState<TranscribeProgressStage>('request')
  const [percent, setPercent] = useState(0)
  const [waitingIndex, setWaitingIndex] = useState(0)

  useEffect(() => {
    if (!active) {
      setStage('request')
      setPercent(0)
      setWaitingIndex(0)
      return
    }

    if (complete) {
      setStage('saving')
      setPercent(100)
      return
    }

    const totalMs = Math.max(18_000, (estimateTranscribeSec(audioDurationSec) ?? 90) * 1000)
    const started = Date.now()

    const tick = () => {
      const ratio = Math.min(FAKE_PROGRESS_CAP, (Date.now() - started) / totalMs)
      setPercent(Math.max(1, Math.round(ratio * 100)))

      for (const item of STAGE_THRESHOLDS) {
        if (ratio <= item.until) {
          setStage(item.stage)
          break
        }
      }
    }

    tick()
    const id = window.setInterval(tick, 400)
    return () => window.clearInterval(id)
  }, [active, audioDurationSec, complete])

  useEffect(() => {
    if (!active || complete) return
    const id = window.setInterval(() => {
      setWaitingIndex((index) => index + 1)
    }, WAITING_LINE_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [active, complete])

  return {
    stage,
    percent,
    label: transcribeStageDescription(stage, waitingIndex),
  }
}
