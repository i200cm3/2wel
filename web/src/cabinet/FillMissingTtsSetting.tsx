import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldContent, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Switch } from '@/components/ui/switch'
import { patchProject } from '@/lib/api'
import { cn } from '@/lib/utils'

type Props = {
  projectCode: string
  enabled: boolean
  onUpdated?: (enabled: boolean) => void
  compact?: boolean
  className?: string
}

export function FillMissingTtsSetting({
  projectCode,
  enabled,
  onUpdated,
  compact = false,
  className,
}: Props) {
  const [checked, setChecked] = useState(enabled)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    setChecked(enabled)
  }, [enabled])

  const toggle = async (next: boolean) => {
    if (!projectCode) return
    const prev = checked
    setChecked(next)
    setPending(true)
    try {
      await patchProject(projectCode, { fillMissingTts: next })
      onUpdated?.(next)
      toast.success(
        next
          ? 'Недостающая озвучка будет генерироваться автоматически'
          : 'Автогенерация недостающей озвучки выключена',
      )
    } catch (err) {
      setChecked(prev)
      toast.error(err instanceof Error ? err.message : 'Не удалось сохранить настройку')
    } finally {
      setPending(false)
    }
  }

  if (compact) {
    return (
      <div
        className={cn(
          'flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-border px-3 py-2.5',
          className,
        )}
      >
        <div className="min-w-0 space-y-0.5">
          <p className="text-sm font-medium">Догенерировать недостающую озвучку</p>
          <p className="text-muted-foreground text-xs">
            Если в шаблоне есть текст TTS, но файла ещё нет — создать при выдаче ссылки.
          </p>
        </div>
        <Switch
          id="fill-missing-tts-compact"
          checked={checked}
          disabled={pending || !projectCode}
          onCheckedChange={(value) => void toggle(value === true)}
          aria-label="Догенерировать недостающую озвучку"
        />
      </div>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-sans">Недостающая озвучка</CardTitle>
        <CardDescription>
          В шаблоне может быть текст TTS без файла (не нажали «Сгенерировать» в конструкторе).
          Включите, чтобы при сборке ссылки такие файлы создавались сами и писались в шаблон.
          Работает отдельно от «Не генерировать TTS при выдаче» (то про озвучку с {'{name}'}).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Field orientation="horizontal" className="items-start justify-between gap-4">
          <FieldContent className="gap-1">
            <FieldLabel htmlFor="fill-missing-tts">Догенерировать ttsSrc по ttsText</FieldLabel>
            <FieldDescription>
              Только статичный текст без {'{name}'}. Файл пишется в опубликованный шаблон при сборке
              ссылки — не при открытии гостем (иначе страница зависает).
            </FieldDescription>
          </FieldContent>
          <Switch
            id="fill-missing-tts"
            checked={checked}
            disabled={pending || !projectCode}
            onCheckedChange={(value) => void toggle(value === true)}
          />
        </Field>
      </CardContent>
    </Card>
  )
}
