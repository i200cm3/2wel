import { useRef, useState } from 'react'
import {
  Ban,
  ExternalLink,
  Phone,
  PhoneIncoming,
  PhoneOutgoing,
  RefreshCw,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
} from '@/components/ui/attachment'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import type { LinkRawSource } from '@/lib/api'
import {
  callDirectionFromTitle,
  callDisplayTitle,
  callDurationSecFromSource,
  estimateTranscribeLabel,
  isManualNonTargetSource,
  isRecordingUrl,
  isShortNonTargetCall,
  recordingUrlFromSource,
  transcribeModelFromSource,
  type CallDirection,
} from '@/cabinet/linkRawSourceKinds'
import type { RecordingAvailability } from '@/cabinet/linkCallRecordingProbe'
import {
  TRANSCRIBE_SAVE_HOLD_MS,
  transcribeAttachmentState,
  useTranscribeProgress,
} from '@/cabinet/useTranscribeProgress'

function formatDt(value: string | null) {
  if (!value) return '—'
  return new Date(value).toLocaleString('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function callStatusLabel(
  source: { title: string; meta?: LinkRawSource['meta'] },
  hasTranscript: boolean,
  recordingUrl: string | null,
  recordingAvailability: RecordingAvailability | undefined,
  transcribeModel: string | null,
) {
  if (isManualNonTargetSource(source)) return 'Нецелевой · вручную'
  if (isShortNonTargetCall(source)) return 'Нецелевой · меньше 30 сек'
  if (hasTranscript) {
    return transcribeModel ? `Транскрипт готов · ${transcribeModel}` : 'Транскрипт готов'
  }
  if (!recordingUrl) return 'Запись недоступна или устарела'
  if (recordingAvailability === 'pending') return 'Проверяем доступность…'
  if (recordingAvailability === 'unavailable') return 'Запись недоступна'
  if (recordingAvailability === 'available') return 'Запись доступна'
  return 'Есть ссылка на запись'
}

function callDirectionLabel(direction: CallDirection | null) {
  if (direction === 'in') return 'Входящий'
  if (direction === 'out') return 'Исходящий'
  return 'Звонок'
}

function callDirectionMediaClass(direction: CallDirection | null) {
  if (direction === 'in') {
    return 'border-green-600/20 bg-green-500/10 text-green-700 dark:border-green-500/30 dark:bg-green-500/15 dark:text-green-400'
  }
  if (direction === 'out') {
    return 'border-blue-600/20 bg-blue-500/10 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/15 dark:text-blue-400'
  }
  return ''
}

function CallDirectionIcon({ direction }: { direction: CallDirection | null }) {
  if (direction === 'in') return <PhoneIncoming aria-hidden className="size-4" />
  if (direction === 'out') return <PhoneOutgoing aria-hidden className="size-4" />
  return <Phone aria-hidden className="size-4" />
}

type LinkAmoCallItemProps = {
  source: LinkRawSource
  recordingAvailability?: RecordingAvailability
  disabled?: boolean
  deleting?: boolean
  onTranscribe: (
    sourceId: string,
    audioUrl: string,
    title: string,
    signal?: AbortSignal,
  ) => Promise<void>
  onDelete: () => Promise<void>
  onSetNonTarget: (nonTarget: boolean) => Promise<void>
}

export function LinkAmoCallItem({
  source,
  recordingAvailability,
  disabled = false,
  deleting = false,
  onTranscribe,
  onDelete,
  onSetNonTarget,
}: LinkAmoCallItemProps) {
  const recordingUrl = recordingUrlFromSource(source)
  const hasTranscript = Boolean(source.body.trim()) && !isRecordingUrl(source.body)
  const savedTranscribeModel = transcribeModelFromSource(source)
  const audioDurationSec = callDurationSecFromSource(source)
  const transcribeEstimate = estimateTranscribeLabel(audioDurationSec)
  const manualNonTarget = isManualNonTargetSource(source)
  const recordingReady =
    Boolean(recordingUrl) &&
    recordingAvailability !== 'unavailable' &&
    recordingAvailability !== 'pending'
  const recordingBlocked =
    !hasTranscript &&
    Boolean(recordingUrl) &&
    (recordingAvailability === 'unavailable' || recordingAvailability === 'pending')
  const direction = callDirectionFromTitle(source.title)
  const [transcribing, setTranscribing] = useState(false)
  const [transcribeComplete, setTranscribeComplete] = useState(false)
  const [nonTargetPending, setNonTargetPending] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const { stage, percent, label } = useTranscribeProgress(
    transcribing,
    audioDurationSec,
    transcribeComplete,
  )
  const busy = disabled || deleting || transcribing || nonTargetPending

  const cancelTranscribe = () => {
    abortRef.current?.abort()
    abortRef.current = null
    setTranscribeComplete(false)
    setTranscribing(false)
  }

  const transcribe = async () => {
    if (!recordingUrl || manualNonTarget) return
    const controller = new AbortController()
    abortRef.current = controller
    setTranscribeComplete(false)
    setTranscribing(true)
    try {
      await onTranscribe(source.id, recordingUrl, source.title || 'Звонок', controller.signal)
      if (controller.signal.aborted) return
      setTranscribeComplete(true)
      await new Promise((resolve) => window.setTimeout(resolve, TRANSCRIBE_SAVE_HOLD_MS))
    } catch (err) {
      if (controller.signal.aborted) return
      throw err
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      setTranscribeComplete(false)
      setTranscribing(false)
    }
  }

  const toggleNonTarget = async () => {
    setNonTargetPending(true)
    try {
      await onSetNonTarget(!manualNonTarget)
    } finally {
      setNonTargetPending(false)
    }
  }

  return (
    <Item variant="outline" className={manualNonTarget ? 'opacity-75' : undefined}>
      <ItemMedia
        variant="icon"
        className={`size-8 rounded-sm border ${callDirectionMediaClass(direction)}`}
        title={callDirectionLabel(direction)}
      >
        <CallDirectionIcon direction={direction} />
      </ItemMedia>
      <ItemContent>
        <ItemTitle className="line-clamp-none break-words">
          {callDisplayTitle(source.title)}
        </ItemTitle>
        <ItemDescription className="line-clamp-none">
          {callStatusLabel(source, hasTranscript, recordingUrl, recordingAvailability, savedTranscribeModel)}
        </ItemDescription>
      </ItemContent>
      <ItemContent className="flex-none text-center">
        <ItemDescription className="tabular-nums whitespace-nowrap">
          {formatDt(source.capturedAt ?? source.createdAt)}
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
          disabled={busy}
          title={manualNonTarget ? 'Вернуть из нецелевых' : 'В нецелевые'}
          aria-label={manualNonTarget ? 'Вернуть из нецелевых' : 'В нецелевые'}
          onClick={() => void toggleNonTarget()}
        >
          {nonTargetPending ? (
            <span className="text-xs">…</span>
          ) : manualNonTarget ? (
            <RotateCcw aria-hidden />
          ) : (
            <Ban aria-hidden />
          )}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-destructive hover:text-destructive shrink-0"
          disabled={busy}
          title="Удалить"
          aria-label="Удалить"
          onClick={() => void onDelete()}
        >
          {deleting ? <span className="text-xs">…</span> : <Trash2 aria-hidden />}
        </Button>
      </ItemActions>

      <ItemFooter className="flex-col items-stretch gap-2">
        {recordingUrl && recordingReady && !manualNonTarget ? (
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={recordingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary inline-flex items-center gap-1 break-all text-sm hover:underline"
            >
              <ExternalLink className="size-3.5 shrink-0" aria-hidden />
              Слушать запись
            </a>
            {!transcribing ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                title={
                  hasTranscript
                    ? transcribeEstimate
                      ? `Перетранскрибировать заново · ~${transcribeEstimate}`
                      : 'Перетранскрибировать запись заново'
                    : transcribeEstimate
                      ? `Примерное время расшифровки: ${transcribeEstimate}`
                      : undefined
                }
                onClick={() => void transcribe()}
              >
                {hasTranscript ? (
                  <>
                    <RefreshCw aria-hidden className="size-3.5" />
                    Перетранскрибировать
                  </>
                ) : transcribeEstimate ? (
                  `Расшифровать ${transcribeEstimate}`
                ) : (
                  'Расшифровать'
                )}
              </Button>
            ) : null}
          </div>
        ) : null}

        {transcribing ? (
          <Attachment state={transcribeAttachmentState(stage)} className="w-full">
            <AttachmentMedia>
              <Spinner />
            </AttachmentMedia>
            <AttachmentContent>
              <AttachmentTitle>{callDisplayTitle(source.title) || 'Расшифровка звонка'}</AttachmentTitle>
              <AttachmentDescription>
                {label} · {percent}%
              </AttachmentDescription>
            </AttachmentContent>
            <AttachmentActions>
              <AttachmentAction aria-label="Отменить расшифровку" onClick={cancelTranscribe}>
                <X aria-hidden />
              </AttachmentAction>
            </AttachmentActions>
          </Attachment>
        ) : null}

        {hasTranscript ? (
          <Accordion className="rounded-md border border-border/60">
            <AccordionItem value="transcript" className="border-0">
              <AccordionTrigger className="px-3 py-2 text-sm hover:no-underline">
                Транскрипт
              </AccordionTrigger>
              <AccordionContent className="px-3 pb-3">
                <Textarea
                  readOnly
                  value={source.body}
                  className="min-h-24 resize-y font-mono text-xs"
                />
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        ) : null}

        {recordingBlocked && !manualNonTarget ? (
          <p className="text-muted-foreground text-xs">
            {recordingAvailability === 'pending'
              ? 'Проверяем, доступна ли запись…'
              : 'Запись сейчас недоступна — расшифровка недоступна.'}
          </p>
        ) : null}
      </ItemFooter>
    </Item>
  )
}
