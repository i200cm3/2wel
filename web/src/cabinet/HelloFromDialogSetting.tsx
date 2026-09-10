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

export function HelloFromDialogSetting({
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
      await patchProject(projectCode, { helloFromDialog: next })
      onUpdated?.(next)
      toast.success(
        next
          ? '{hello} будет собираться по разговору'
          : '{hello} выключен — в ролике пустая строка',
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
          'flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3',
          className,
        )}
      >
        <div className="min-w-0 space-y-0.5">
          <p className="text-sm font-medium">Персональное {'{hello}'}</p>
          <p className="text-muted-foreground text-xs">
            Дополнительный промпт по звонку. Выключено — {'{hello}'} пустой.
          </p>
        </div>
        <Switch
          id="hello-from-dialog-compact"
          checked={checked}
          disabled={pending || !projectCode}
          onCheckedChange={(value) => void toggle(value === true)}
          aria-label="Персональное приветствие из разговора"
        />
      </div>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-sans">Персональное {'{hello}'}</CardTitle>
        <CardDescription>
          Если в титре или озвучке есть {'{hello}'}, после звонка модель напишет первую фразу по
          диалогу. Выключите, чтобы проверить ролик без этой фразы — слот станет пустым.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Field orientation="horizontal" className="items-start justify-between gap-4">
          <FieldContent className="gap-1">
            <FieldLabel htmlFor="hello-from-dialog">Собирать {'{hello}'} из разговора</FieldLabel>
            <FieldDescription>
              Не обещает наличие номеров и цены. Если зацепки нет — «Здравствуйте, {'{name}'}!».
            </FieldDescription>
          </FieldContent>
          <Switch
            id="hello-from-dialog"
            checked={checked}
            disabled={pending || !projectCode}
            onCheckedChange={(value) => void toggle(value === true)}
          />
        </Field>
      </CardContent>
    </Card>
  )
}
