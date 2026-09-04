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

export function SkipTtsOnLinkIssueSetting({
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
      await patchProject(projectCode, { skipTtsOnLinkIssue: next })
      onUpdated?.(next)
      toast.success(
        next
          ? 'TTS при выдаче отключён — токены не тратятся'
          : 'TTS при выдаче снова включён',
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
          'flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-primary/40 bg-primary/5 px-3 py-2.5',
          className,
        )}
      >
        <div className="min-w-0 space-y-0.5">
          <p className="text-sm font-medium">Не генерировать TTS при выдаче</p>
          <p className="text-muted-foreground text-xs">
            Без синтеза озвучки при «Выдать ссылку» — экономия токенов при тестах.
          </p>
        </div>
        <Switch
          id="skip-tts-on-link-issue-compact"
          checked={checked}
          disabled={pending || !projectCode}
          onCheckedChange={(value) => void toggle(value === true)}
          aria-label="Не генерировать TTS при выдаче"
        />
      </div>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-sans">Выдача ссылок</CardTitle>
        <CardDescription>
          Персональная озвучка с {'{name}'} обычно генерируется при каждой выдаче ссылки в кабинете
          и через API. Отключите, если тестируете сборку и не хотите тратить токены.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Field orientation="horizontal" className="items-start justify-between gap-4">
          <FieldContent className="gap-1">
            <FieldLabel htmlFor="skip-tts-on-link-issue">Не генерировать TTS при выдаче</FieldLabel>
            <FieldDescription>
              Ссылка создаётся сразу. Озвучка с именем гостя появится при первом открытии презентации
              (если в шаблоне есть {'{name}'}).
            </FieldDescription>
          </FieldContent>
          <Switch
            id="skip-tts-on-link-issue"
            checked={checked}
            disabled={pending || !projectCode}
            onCheckedChange={(value) => void toggle(value === true)}
          />
        </Field>
      </CardContent>
    </Card>
  )
}
