import { useEffect, useState } from 'react'
import { Ban, Check, Pencil, RotateCcw, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import type { LinkRawSource } from '@/lib/api'
import { cn } from '@/lib/utils'
import {
  isManualNonTargetSource,
  RAW_KIND_LABELS,
  RAW_KIND_OPTIONS,
  rawSourceTitle,
} from '@/cabinet/linkRawSourceKinds'

function formatDt(value: string | null) {
  if (!value) return '—'
  return new Date(value).toLocaleString('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export type RawSourcePayload = {
  body?: string
  kind: string
  title: string
  audioUrl?: string
}

type LinkRawSourceItemProps = {
  source: LinkRawSource
  disabled?: boolean
  deleting?: boolean
  onSave: (payload: RawSourcePayload) => Promise<void>
  onDelete: () => Promise<void>
  onSetNonTarget: (nonTarget: boolean) => Promise<void>
}

export function LinkRawSourceItem({
  source,
  disabled = false,
  deleting = false,
  onSave,
  onDelete,
  onSetNonTarget,
}: LinkRawSourceItemProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [body, setBody] = useState(source.body)
  const [kind, setKind] = useState(source.kind)
  const [saving, setSaving] = useState(false)
  const [nonTargetPending, setNonTargetPending] = useState(false)
  const manualNonTarget = isManualNonTargetSource(source)

  useEffect(() => {
    if (!isEditing) {
      setBody(source.body)
      setKind(source.kind)
    }
  }, [source.body, source.kind, isEditing])

  const busy = disabled || saving || deleting || nonTargetPending

  const cancel = () => {
    setBody(source.body)
    setKind(source.kind)
    setIsEditing(false)
  }

  const save = async () => {
    const text = body.trim()
    if (!text) return
    setSaving(true)
    try {
      await onSave({ body: text, kind, title: rawSourceTitle(kind) })
      setIsEditing(false)
    } finally {
      setSaving(false)
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
    <li
      className={cn(
        'rounded-lg border border-border/80 bg-muted/20 px-3 py-2 text-xs',
        isEditing && 'border-primary/40 ring-1 ring-primary/15',
        manualNonTarget && 'opacity-75',
      )}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="text-muted-foreground min-w-0">
          {!isEditing ? (
            <>
              <span className="text-foreground text-sm font-medium">
                {RAW_KIND_LABELS[source.kind] ?? source.kind}
                {source.title ? ` · ${source.title}` : ''}
                {manualNonTarget ? ' · нецелевой' : ''}
              </span>
              <div>{formatDt(source.createdAt)}</div>
            </>
          ) : (
            <NativeSelect
              value={kind}
              onChange={(event) => setKind(event.target.value)}
              className="h-8 w-full max-w-xs"
              disabled={busy}
            >
              {RAW_KIND_OPTIONS.map(([value, label]) => (
                <NativeSelectOption key={value} value={value}>
                  {label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </div>
        <div className="flex shrink-0 gap-0.5">
          {isEditing ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={busy || !body.trim()}
                title="Сохранить"
                aria-label="Сохранить"
                onClick={() => void save()}
              >
                <Check aria-hidden />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={busy}
                title="Отмена"
                aria-label="Отмена"
                onClick={cancel}
              >
                <X aria-hidden />
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
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
                disabled={busy}
                title="Изменить"
                aria-label="Изменить"
                onClick={() => setIsEditing(true)}
              >
                <Pencil aria-hidden />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="text-destructive hover:text-destructive"
                disabled={busy}
                title="Удалить"
                aria-label="Удалить"
                onClick={() => void onDelete()}
              >
                {deleting ? <span className="text-xs">…</span> : <Trash2 aria-hidden />}
              </Button>
            </>
          )}
        </div>
      </div>
      <Textarea
        readOnly={!isEditing}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        rows={Math.min(12, Math.max(3, body.split('\n').length + 1))}
        className={cn(
          'text-xs',
          !isEditing &&
            'border-transparent bg-muted/40 shadow-none focus-visible:border-transparent focus-visible:ring-0',
        )}
      />
    </li>
  )
}

type LinkRawSourceDraftProps = {
  disabled?: boolean
  onSave: (payload: RawSourcePayload) => Promise<void>
}

export function LinkRawSourceDraft({ disabled = false, onSave }: LinkRawSourceDraftProps) {
  const [body, setBody] = useState('')
  const [audioUrl, setAudioUrl] = useState('')
  const [kind, setKind] = useState('manual')
  const [saving, setSaving] = useState(false)

  const busy = disabled || saving
  const isCall = kind === 'call_transcript'
  const transcribing = saving && isCall && audioUrl.trim() && !body.trim()
  const canSave = isCall ? audioUrl.trim() || body.trim() : body.trim()

  const save = async () => {
    if (!canSave) return
    setSaving(true)
    try {
      const payload: RawSourcePayload = {
        kind,
        title: rawSourceTitle(kind),
      }
      const url = audioUrl.trim()
      const text = body.trim()
      if (isCall && url && !text) {
        payload.audioUrl = url
      } else {
        payload.body = text
        if (isCall && url) payload.audioUrl = url
      }
      await onSave(payload)
      setBody('')
      setAudioUrl('')
      setKind('manual')
    } finally {
      setSaving(false)
    }
  }

  return (
    <li className="rounded-lg border border-dashed border-border/80 bg-muted/20 px-3 py-2 text-xs">
      <p className="text-muted-foreground mb-2 text-sm font-medium">Добавить запись</p>
      <NativeSelect
        value={kind}
        onChange={(event) => setKind(event.target.value)}
        className="mb-2 h-8 w-full max-w-xs"
        disabled={busy}
      >
        {RAW_KIND_OPTIONS.map(([value, label]) => (
          <NativeSelectOption key={value} value={value}>
            {label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      {isCall ? (
        <Input
          type="url"
          value={audioUrl}
          onChange={(event) => setAudioUrl(event.target.value)}
          placeholder="https://sipuni.com/api/crm/record?id=…&hash=…&user=…"
          disabled={busy}
          className="mb-2 h-8 text-xs"
        />
      ) : null}
      <Textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder={
          isCall
            ? 'Или вставьте транскрипт звонка вручную…'
            : 'Вставьте чат или транскрипт звонка…'
        }
        rows={isCall ? 3 : 4}
        disabled={busy}
        className="text-xs"
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-2"
        disabled={busy || !canSave}
        onClick={() => void save()}
      >
        {saving ? (
          <>
            <Spinner data-icon="inline-start" aria-hidden />
            {transcribing ? 'Транскрибация…' : 'Сохранение…'}
          </>
        ) : isCall && audioUrl.trim() && !body.trim() ? (
          'Транскрибировать и добавить'
        ) : (
          'Сохранить'
        )}
      </Button>
    </li>
  )
}
