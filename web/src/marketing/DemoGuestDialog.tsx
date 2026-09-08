import { useState, type FormEvent } from 'react'
import { ApiError, requestDemoGuest } from '@/lib/api'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Field, FieldGroup } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

type Props = {
  className?: string
  onOpenChange?: (open: boolean) => void
}

export function DemoGuestDialog({ className, onOpenChange }: Props) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ mailed: boolean; reused: boolean } | null>(null)

  const resetForm = () => {
    setName('')
    setEmail('')
    setPending(false)
    setError(null)
    setDone(null)
  }

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    onOpenChange?.(next)
    resetForm()
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (pending) return
    setPending(true)
    setError(null)
    void requestDemoGuest({ name: name.trim(), email: email.trim() })
      .then((result) => {
        setDone({ mailed: result.mailed, reused: result.reused })
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : 'Не удалось отправить демо')
      })
      .finally(() => setPending(false))
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={<button type="button" className={cn(className)} />}
      >
        Получить демо презентации
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        {done ? (
          <>
            <DialogHeader>
              <DialogTitle>Ссылка отправлена</DialogTitle>
              <DialogDescription>
                {done.mailed
                  ? done.reused
                    ? 'На эту почту уже выдавали демо — отправили ту же ссылку. Имя в презентации не меняется.'
                    : 'Проверьте почту — там демо-презентация гостя.'
                  : 'Запрос принят. Если письма нет, напишите на support@2wel.ru.'}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose render={<Button type="button">Закрыть</Button>} />
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={onSubmit}>
            <DialogHeader>
              <DialogTitle>Демо презентации</DialogTitle>
              <DialogDescription>
                Имя и email — пришлём ссылку на почту. Повторно на тот же email уйдёт та же
                ссылка: имя в ней уже не меняется.
              </DialogDescription>
            </DialogHeader>
            <FieldGroup className="py-2">
              <Field>
                <Label htmlFor="demo-guest-name">Имя</Label>
                <Input
                  id="demo-guest-name"
                  name="name"
                  autoComplete="given-name"
                  placeholder="Анна"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                  disabled={pending}
                />
              </Field>
              <Field>
                <Label htmlFor="demo-guest-email">Email</Label>
                <Input
                  id="demo-guest-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder="anna@hotel.ru"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  disabled={pending}
                />
              </Field>
            </FieldGroup>
            {error ? <p className="text-destructive text-sm">{error}</p> : null}
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="outline" disabled={pending} />}>
                Отмена
              </DialogClose>
              <Button type="submit" disabled={pending || !name.trim() || !email.trim()}>
                {pending ? 'Отправляем…' : 'Отправить ссылку'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
