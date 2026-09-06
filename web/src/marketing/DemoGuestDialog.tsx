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
  const [done, setDone] = useState<{ url: string; mailed: boolean } | null>(null)

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
    // Всегда чистая форма при открытии/закрытии — не оставляем экран «ссылка готова».
    resetForm()
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (pending) return
    setPending(true)
    setError(null)
    void requestDemoGuest({ name: name.trim(), email: email.trim() })
      .then((result) => {
        setDone(result)
        window.open(result.url, '_blank', 'noopener,noreferrer')
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : 'Не удалось открыть демо')
      })
      .finally(() => setPending(false))
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={<button type="button" className={cn(className)} />}
      >
        Открыть демо гостя
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        {done ? (
          <>
            <DialogHeader>
              <DialogTitle>Демо готово</DialogTitle>
              <DialogDescription>
                {done.mailed
                  ? 'Ссылка открыта и продублирована на вашу почту.'
                  : 'Ссылка открыта в новой вкладке. Письмо не отправилось — сохраните адрес ниже.'}
              </DialogDescription>
            </DialogHeader>
            <p className="break-all text-sm">
              <a
                className="text-primary underline-offset-4 hover:underline"
                href={done.url}
                target="_blank"
                rel="noreferrer"
              >
                {done.url}
              </a>
            </p>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => resetForm()}>
                Другое имя
              </Button>
              <DialogClose render={<Button type="button">Закрыть</Button>} />
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={onSubmit}>
            <DialogHeader>
              <DialogTitle>Персональное демо</DialogTitle>
              <DialogDescription>
                Укажите имя и email — откроем гостевую страницу и отправим ссылку на почту.
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
                {pending ? 'Готовим…' : 'Открыть демо'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
