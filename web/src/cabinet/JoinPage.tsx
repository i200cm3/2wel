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
import { FieldDescription, FieldGroup } from '@/components/ui/field'
import { acceptJoinInvite, fetchJoinInvite, type JoinInviteInfo } from '@/lib/auth'

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
  const [invite, setInvite] = useState<JoinInviteInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [doneEmail, setDoneEmail] = useState<string | null>(null)

  useEffect(() => {
    document.documentElement.classList.add('login-open')
    return () => document.documentElement.classList.remove('login-open')
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (!token) {
        setError('Нет ссылки-приглашения')
        setReady(true)
        return
      }
      try {
        const data = await fetchJoinInvite(token)
        if (cancelled) return
        setInvite(data)
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

  const goToProject = (code?: string | null) => {
    navigate(postJoinPath(code || invite?.projectCode), { replace: true })
  }

  const join = () => {
    setPending(true)
    setError(null)
    void acceptJoinInvite(token)
      .then((result) => {
        setDoneEmail(result.email || invite?.email || null)
        if (!result.emailed) {
          setError(
            'Вы в объекте, но письмо с паролем не отправилось. Запросите сброс пароля на экране входа.',
          )
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
              Приглашение в команду
            </CardTitle>
            <CardDescription className="text-sm">
              {invite
                ? `Вас пригласили в объект «${invite.projectName}». Нажмите кнопку — пароль придёт на ${invite.email || 'почту из приглашения'}.`
                : 'Ссылка недействительна или уже использована.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {error ? <p className="text-destructive mb-4 text-sm">{error}</p> : null}
            {!invite ? (
              <Button nativeButton={false} render={<Link to="/login" />} className="w-full text-sm">
                Войти
              </Button>
            ) : doneEmail ? (
              <FieldGroup>
                <p className="text-sm">Пароль отправили на {doneEmail}. Открываем кабинет…</p>
                <Button type="button" onClick={() => goToProject()} className="w-full text-sm">
                  В объект
                </Button>
              </FieldGroup>
            ) : (
              <FieldGroup>
                <Button type="button" disabled={pending} onClick={join} className="w-full text-sm">
                  {pending ? 'Подключаю…' : `Присоединиться к «${invite.projectName}»`}
                </Button>
                <FieldDescription className="text-center text-sm">
                  Аккаунт на {invite.email || 'вашу почту'}. Пароль придёт письмом.
                </FieldDescription>
              </FieldGroup>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
