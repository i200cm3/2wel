import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { toast } from 'sonner'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { CabinetOutlet } from '@/cabinet/CabinetLayout'
import { checkProjectCode, patchProject } from '@/lib/api'
import {
  changePassword,
  createInvite,
  fetchInvites,
  type Invite,
  type RegistrationInfo,
} from '@/lib/auth'
import { validateProjectCode } from '@/lib/projectCode'
import { GUEST_BASE_DOMAIN } from '@/lib/utils'

function formatDt(value: string | null) {
  if (!value) return '—'
  return new Date(value).toLocaleString('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function inviteUrl(token: string) {
  return `${window.location.origin}/register?invite=${encodeURIComponent(token)}`
}

export function AccountPage() {
  const { projects, project, reloadProjects } = useOutletContext<CabinetOutlet>()
  const object = project ?? projects[0] ?? null
  const [registration, setRegistration] = useState<RegistrationInfo | null>(null)
  const [invites, setInvites] = useState<Invite[]>([])
  const [error, setError] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [pendingInvite, setPendingInvite] = useState(false)
  const [pendingPassword, setPendingPassword] = useState(false)
  const [revealed, setRevealed] = useState<string | null>(null)
  const [objectName, setObjectName] = useState(object?.name ?? '')
  const [objectCode, setObjectCode] = useState(object?.code ?? '')
  const [pendingObject, setPendingObject] = useState(false)
  const [codeTaken, setCodeTaken] = useState<string | null>(null)
  const [checkingCode, setCheckingCode] = useState(false)

  useEffect(() => {
    setObjectName(object?.name ?? '')
    setObjectCode(object?.code ?? '')
  }, [object?.id, object?.name, object?.code])

  const trimmedCode = objectCode.trim().toLowerCase()
  const formatCheck = validateProjectCode(trimmedCode)
  const unchangedCode = trimmedCode === (object?.code ?? '')
  const codeToCheck = formatCheck.ok && !unchangedCode ? formatCheck.code : ''

  useEffect(() => {
    setCodeTaken(null)
    if (!codeToCheck) {
      setCheckingCode(false)
      return
    }
    let cancelled = false
    setCheckingCode(true)
    const timer = window.setTimeout(() => {
      void checkProjectCode(codeToCheck)
        .then((data) => {
          if (cancelled) return
          setCodeTaken(data.available ? null : (data.error ?? 'Этот адрес уже занят'))
        })
        .catch(() => undefined)
        .finally(() => {
          if (!cancelled) setCheckingCode(false)
        })
    }, 400)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [codeToCheck])

  useEffect(() => {
    let cancelled = false
    void fetchInvites()
      .then((data) => {
        if (cancelled) return
        setRegistration({
          mode: data.mode,
          open: data.open,
          invite: data.invite,
          canInvite: Boolean(data.canInvite),
        })
        setInvites(data.invites)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Ошибка')
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (error) return <p className="text-destructive p-6">{error}</p>
  if (!registration) return <p className="text-muted-foreground p-6">Загрузка…</p>

  const modeLabel =
    registration.mode === 'open'
      ? 'открыта для всех'
      : registration.mode === 'invite'
        ? 'только по приглашению'
        : 'закрыта'

  const codePreview = formatCheck.ok ? formatCheck.code : ''
  const guestExample = `https://${codePreview || 'plaza'}.${GUEST_BASE_DOMAIN}/xxxx`
  const codeError = formatCheck.ok ? codeTaken : formatCheck.error
  const codeInvalid = Boolean(codeError)

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 md:p-6">
      {object ? (
        <Card>
          <CardHeader>
            <CardTitle className="font-sans">Объект</CardTitle>
            <CardDescription>
              Название видят сотрудники в кабинете. Адрес — то, что открывает гость в SMS и WhatsApp.
              Ссылки выглядят так: <code>https://{codePreview || 'plaza'}.{GUEST_BASE_DOMAIN}/xxxx</code>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="flex max-w-md flex-col gap-3"
              onSubmit={(event) => {
                event.preventDefault()
                if (codeInvalid) return
                setPendingObject(true)
                void patchProject(object.code, { name: objectName.trim(), code: trimmedCode })
                  .then(async (data) => {
                    await reloadProjects()
                    if (data.guestHost && data.guestHost.ok === false && data.guestHost.error) {
                      toast.warning(`Объект сохранён. Адрес ${data.guestHost.host}: ${data.guestHost.error}`)
                    } else {
                      toast.success('Объект сохранён')
                    }
                  })
                  .catch((err) =>
                    toast.error(err instanceof Error ? err.message : 'Не удалось сохранить'),
                  )
                  .finally(() => setPendingObject(false))
              }}
            >
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">Название объекта</span>
                <Input
                  value={objectName}
                  onChange={(event) => setObjectName(event.target.value)}
                  placeholder="Санаторий Плаза"
                  required
                  maxLength={80}
                  disabled={pendingObject}
                />
              </label>
              <Field data-invalid={codeInvalid || undefined}>
                <FieldLabel htmlFor="object-code" className="text-muted-foreground text-sm font-normal">
                  Адрес ссылок
                </FieldLabel>
                <div className="flex items-center gap-1">
                  <Input
                    id="object-code"
                    value={objectCode}
                    onChange={(event) => setObjectCode(event.target.value.toLowerCase())}
                    placeholder="plaza"
                    required
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    disabled={pendingObject}
                    aria-invalid={codeInvalid || undefined}
                    aria-describedby="object-code-hint"
                    className="font-mono"
                  />
                  <span className="text-muted-foreground shrink-0 text-sm">.{GUEST_BASE_DOMAIN}</span>
                </div>
                <FieldError>{codeError}</FieldError>
                <FieldDescription id="object-code-hint" className="text-xs">
                  {checkingCode
                    ? 'Проверяем, свободен ли адрес…'
                    : `Латиница, цифры и дефис. Это не сайт отеля, а короткая ссылка гостю: ${guestExample}`}
                </FieldDescription>
              </Field>
              <Button
                type="submit"
                disabled={pendingObject || checkingCode || codeInvalid || !objectName.trim()}
              >
                {pendingObject ? 'Настраиваю адрес…' : 'Сохранить'}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle className="font-sans">Безопасность</CardTitle>
          <CardDescription>Смена пароля для входа в кабинет. Не короче 8 символов.</CardDescription>
        </CardHeader>
        <CardContent>
          <Accordion>
            <AccordionItem value="password">
              <AccordionTrigger>Сменить пароль</AccordionTrigger>
              <AccordionContent>
                <form
                  className="flex max-w-md flex-col gap-3 pt-1"
                  onSubmit={(event) => {
                    event.preventDefault()
                    setPendingPassword(true)
                    void changePassword(currentPassword, newPassword)
                      .then(() => {
                        setCurrentPassword('')
                        setNewPassword('')
                        toast.success('Пароль обновлён')
                      })
                      .catch((err) =>
                        toast.error(err instanceof Error ? err.message : 'Не удалось сменить'),
                      )
                      .finally(() => setPendingPassword(false))
                  }}
                >
                  <Field>
                    <FieldLabel htmlFor="current-password" className="text-muted-foreground font-normal">
                      Текущий пароль
                    </FieldLabel>
                    <Input
                      id="current-password"
                      type="password"
                      autoComplete="current-password"
                      value={currentPassword}
                      onChange={(event) => setCurrentPassword(event.target.value)}
                      required
                      disabled={pendingPassword}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="new-password" className="text-muted-foreground font-normal">
                      Новый пароль
                    </FieldLabel>
                    <Input
                      id="new-password"
                      type="password"
                      autoComplete="new-password"
                      minLength={8}
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
                      required
                      disabled={pendingPassword}
                    />
                    <FieldDescription>Не короче 8 символов.</FieldDescription>
                  </Field>
                  <Button type="submit" disabled={pendingPassword || newPassword.length < 8}>
                    {pendingPassword ? 'Сохранение…' : 'Сменить пароль'}
                  </Button>
                </form>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="font-sans">Доступ</CardTitle>
          <CardDescription>
            Регистрация {modeLabel}.
            {registration.canInvite
              ? ' Приглашение — одноразовая ссылка на 14 дней. Приглашённый не сможет звать других.'
              : ' Приглашать может только администратор.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {revealed ? (
            <div className="bg-muted space-y-2 rounded-lg p-3">
              <p className="text-sm font-medium">Ссылка показывается один раз</p>
              <code className="block break-all text-xs">{revealed}</code>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard.writeText(revealed).then(() => toast.success('Скопировано'))
                }}
              >
                Копировать
              </Button>
            </div>
          ) : null}
          {registration.canInvite ? (
            <>
            <form
              className="flex flex-col gap-2 sm:flex-row sm:items-end"
              onSubmit={(event) => {
                event.preventDefault()
                setPendingInvite(true)
                void createInvite(email.trim())
                  .then((data) => {
                    const url = data.invite.token ? inviteUrl(data.invite.token) : ''
                    setEmail('')
                    setRevealed(url || null)
                    if (url) void navigator.clipboard.writeText(url).catch(() => undefined)
                    toast.success('Приглашение создано')
                    return fetchInvites()
                  })
                  .then((data) => setInvites(data.invites))
                  .catch((err) => toast.error(err instanceof Error ? err.message : 'Не удалось создать'))
                  .finally(() => setPendingInvite(false))
              }}
            >
              <label className="flex min-w-40 flex-1 flex-col gap-1 text-sm">
                <span className="text-muted-foreground">Email (необязательно)</span>
                <Input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="можно ограничить почтой"
                  disabled={pendingInvite}
                />
              </label>
              <Button type="submit" disabled={pendingInvite}>
                {pendingInvite ? 'Создание…' : 'Создать приглашение'}
              </Button>
            </form>
          <div className="overflow-hidden rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Создано</TableHead>
                  <TableHead>Истекает</TableHead>
                  <TableHead>Статус</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invites.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-muted-foreground">
                      Приглашений пока нет
                    </TableCell>
                  </TableRow>
                ) : (
                  invites.map((item) => (
                    <TableRow key={item.id} className={item.usedAt ? 'opacity-60' : undefined}>
                      <TableCell>{item.email || '—'}</TableCell>
                      <TableCell>{formatDt(item.createdAt)}</TableCell>
                      <TableCell>{formatDt(item.expiresAt)}</TableCell>
                      <TableCell>{item.usedAt ? 'использовано' : 'активно'}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
            </>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
