import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { BrandLogo } from '@/components/BrandLogo'
import { ModeToggle } from '@/components/ModeToggle'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp'
import { REGEXP_ONLY_DIGITS } from 'input-otp'
import { RefreshCw } from 'lucide-react'
import {
  acceptJoinInvite,
  fetchJoinInvite,
  fetchSessionUser,
  resendAuthOtp,
  verifyAuthOtp,
  type JoinInviteInfo,
} from '@/lib/auth'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MIN_PASSWORD = 8

function postJoinPath(code: string | null | undefined) {
  const value = String(code ?? '').trim().toLowerCase()
  if (!value) return '/app'
  return `/app/projects/${encodeURIComponent(value)}`
}

export function JoinPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const token = params.get('invite') || params.get('token') || ''
  const [ready, setReady] = useState(false)
  const [authed, setAuthed] = useState(false)
  const [invite, setInvite] = useState<JoinInviteInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [otpEmail, setOtpEmail] = useState<string | null>(null)
  const [otp, setOtp] = useState('')
  const [remember, setRemember] = useState(true)

  useEffect(() => {
    document.documentElement.classList.add('login-open')
    return () => document.documentElement.classList.remove('login-open')
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const user = await fetchSessionUser()
      if (cancelled) return
      setAuthed(Boolean(user))
      if (!token) {
        setError('Нет ссылки-приглашения')
        setReady(true)
        return
      }
      try {
        const data = await fetchJoinInvite(token)
        if (cancelled) return
        setInvite(data)
        setEmail(data.email || '')
        setError(null)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Приглашение недействительно')
      } finally {
        if (!cancelled) setReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token])

  if (!ready) {
    return <div className="text-muted-foreground flex min-h-svh items-center justify-center">Загрузка…</div>
  }

  const loginNext = `/join?invite=${encodeURIComponent(token)}`
  const goToProject = (code?: string | null) => {
    navigate(postJoinPath(code || invite?.projectCode), { replace: true })
  }

  const join = (extras?: { email?: string; password?: string }) => {
    setPending(true)
    setError(null)
    setNotice(null)
    void acceptJoinInvite(token, { remember, ...extras })
      .then((result) => {
        if (result.needsOtp && result.email) {
          setOtpEmail(result.email)
          setNotice('Код отправили на почту.')
          return
        }
        goToProject(result.projectCode)
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Не удалось присоединиться'))
      .finally(() => setPending(false))
  }

  return (
    <div className="bg-background text-foreground relative flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="absolute top-4 right-4">
        <ModeToggle />
      </div>
      <div className="flex w-full max-w-sm flex-col items-center gap-6">
        <Link to="/" className="block overflow-hidden rounded-lg" aria-label="2wel — на главную">
          <BrandLogo size="lg" />
        </Link>
        <Card className="w-full text-base [--card-spacing:--spacing(6)]">
          <CardHeader>
            <CardTitle className="font-sans text-xl leading-none font-semibold tracking-tight">
              {otpEmail ? 'Код из письма' : 'Приглашение в команду'}
            </CardTitle>
            <CardDescription className="text-sm">
              {otpEmail
                ? 'Четыре цифры с support@2wel.ru, 10 минут'
                : invite
                  ? `Вас пригласили в объект «${invite.projectName}». Это доступ сотрудника, без прав администратора.`
                  : 'Ссылка недействительна или уже использована.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {error ? <p className="text-destructive mb-4 text-sm">{error}</p> : null}
            {notice ? <p className="text-muted-foreground mb-4 text-sm">{notice}</p> : null}
            {!invite ? (
              <Button nativeButton={false} render={<Link to="/login" />} className="w-full text-sm">
                Войти
              </Button>
            ) : otpEmail ? (
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="otp" className="text-sm">
                    Код из письма
                  </FieldLabel>
                  <InputOTP
                    id="otp"
                    maxLength={4}
                    pattern={REGEXP_ONLY_DIGITS}
                    value={otp}
                    onChange={setOtp}
                    disabled={pending}
                    autoFocus
                    containerClassName="justify-center"
                    onComplete={(value) => {
                      if (!pending && value.length === 4) {
                        setPending(true)
                        void verifyAuthOtp(otpEmail, 'register', value, remember)
                          .then(() => goToProject(invite.projectCode))
                          .catch((err) => setError(err instanceof Error ? err.message : 'Неверный код'))
                          .finally(() => setPending(false))
                      }
                    }}
                  >
                    <InputOTPGroup>
                      <InputOTPSlot index={0} className="size-10 text-base" />
                      <InputOTPSlot index={1} className="size-10 text-base" />
                      <InputOTPSlot index={2} className="size-10 text-base" />
                      <InputOTPSlot index={3} className="size-10 text-base" />
                    </InputOTPGroup>
                  </InputOTP>
                  <FieldDescription className="text-center text-xs">
                    Код отправили на {otpEmail}
                  </FieldDescription>
                </Field>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => {
                    setPending(true)
                    void resendAuthOtp(otpEmail, 'register')
                      .then(() => setNotice('Отправили новый код.'))
                      .catch((err) => setError(err instanceof Error ? err.message : 'Не удалось отправить код'))
                      .finally(() => setPending(false))
                  }}
                  className="w-full text-sm"
                >
                  <RefreshCw aria-hidden />
                  Отправить код ещё раз
                </Button>
              </FieldGroup>
            ) : authed ? (
              <FieldGroup>
                <Button type="button" disabled={pending} onClick={() => join()} className="w-full text-sm">
                  {pending ? 'Подключаю…' : `Присоединиться к «${invite.projectName}»`}
                </Button>
                <FieldDescription className="text-center text-sm">
                  <Link to="/app" className="text-primary underline-offset-4 hover:underline">
                    В кабинет без этого объекта
                  </Link>
                </FieldDescription>
              </FieldGroup>
            ) : invite.existingUser ? (
              <FieldGroup>
                <p className="text-sm">
                  Для почты {invite.email} уже есть аккаунт. Войдите — и попадёте в объект.
                </p>
                <Button
                  nativeButton={false}
                  render={<Link to={`/login?next=${encodeURIComponent(loginNext)}`} />}
                  className="w-full text-sm"
                >
                  Войти
                </Button>
              </FieldGroup>
            ) : (
              <form
                onSubmit={(event) => {
                  event.preventDefault()
                  if (!EMAIL_RE.test(email.trim()) || password.length < MIN_PASSWORD) return
                  join({ email: email.trim(), password })
                }}
              >
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="join-email" className="text-sm">
                      Почта
                    </FieldLabel>
                    <Input
                      id="join-email"
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      required
                      disabled={pending || Boolean(invite.email)}
                      className="h-9 text-sm"
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="join-password" className="text-sm">
                      Пароль
                    </FieldLabel>
                    <Input
                      id="join-password"
                      type="password"
                      autoComplete="new-password"
                      minLength={MIN_PASSWORD}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      required
                      disabled={pending}
                      className="h-9 text-sm"
                    />
                    <FieldDescription>Не короче 8 символов. Свой аккаунт, без прав админа.</FieldDescription>
                  </Field>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={remember}
                      onChange={(event) => setRemember(event.target.checked)}
                      disabled={pending}
                    />
                    Запомнить вход
                  </label>
                  <Button type="submit" disabled={pending} className="w-full text-sm">
                    {pending ? 'Создаю аккаунт…' : 'Создать аккаунт и войти'}
                  </Button>
                  <FieldDescription className="text-center text-sm">
                    Уже есть аккаунт?{' '}
                    <Link
                      to={`/login?next=${encodeURIComponent(loginNext)}`}
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      Войти
                    </Link>
                  </FieldDescription>
                </FieldGroup>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
