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
  /** Компактная строка для формы выдачи ссылок. */
  compact?: boolean
  className?: string
}

export function CaptionsFromTtsSetting({
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
      await patchProject(projectCode, { captionsFromTts: next })
      onUpdated?.(next)
      toast.success(
        next
          ? 'В титрах будет текст TTS'
          : 'В титрах снова короткий текст',
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
          <p className="text-sm font-medium">В титрах показывать текст TTS</p>
          <p className="text-muted-foreground text-xs">
            В гостевой презентации вместо короткого титра — полный текст озвучки.
          </p>
        </div>
        <Switch
          id="captions-from-tts-compact"
          checked={checked}
          disabled={pending || !projectCode}
          onCheckedChange={(value) => void toggle(value === true)}
          aria-label="В титрах показывать текст TTS"
        />
      </div>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-sans">Титры и озвучка</CardTitle>
        <CardDescription>
          Обычно в титре короткий текст, а в озвучке — развёрнутый. Включите, чтобы гость видел
          тот же текст, что слышит.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Field orientation="horizontal" className="items-start justify-between gap-4">
          <FieldContent className="gap-1">
            <FieldLabel htmlFor="captions-from-tts">В титрах показывать текст TTS</FieldLabel>
            <FieldDescription>
              Подставляется при открытии ссылки. В конструкторе титры остаются как заданы.
            </FieldDescription>
          </FieldContent>
          <Switch
            id="captions-from-tts"
            checked={checked}
            disabled={pending || !projectCode}
            onCheckedChange={(value) => void toggle(value === true)}
          />
        </Field>
      </CardContent>
    </Card>
  )
}
