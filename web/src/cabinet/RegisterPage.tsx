import { useEffect, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { EditorLoginPage } from '@/components/EditorLoginPage'
import { fetchRegistration, fetchSessionUser, registerEditor, resendAuthOtp, verifyAuthOtp } from '@/lib/auth'

export function RegisterPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = params.get('next') || '/app'
  const invite = params.get('invite') || ''
  const [ready, setReady] = useState(false)
  const [authed, setAuthed] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [mode, setMode] = useState<'register' | 'closed'>('register')
  const [inviteRequired, setInviteRequired] = useState(false)
  const [otpEmail, setOtpEmail] = useState<string | null>(null)
  const [remember, setRemember] = useState(true)
  const [createdCode, setCreatedCode] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void Promise.all([fetchSessionUser(), fetchRegistration()]).then(([user, registration]) => {
      if (cancelled) return
      setAuthed(Boolean(user))
      if (registration.mode === 'closed') setMode('closed')
      setInviteRequired(registration.mode === 'invite')
      setReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (!ready) {
    return <div className="text-muted-foreground flex min-h-svh items-center justify-center">Загрузка…</div>
  }
  if (authed) {
    return <Navigate to={next.startsWith('/') ? next : '/app'} replace />
  }

  return (
    <EditorLoginPage
      mode={otpEmail ? 'otp' : mode}
      invite={invite}
      inviteRequired={inviteRequired}
      otpEmail={otpEmail ?? ''}
      error={error}
      notice={notice}
      pending={pending}
      onRegister={(email, password, projectName, projectCode, inviteToken, nextRemember) => {
        if (inviteRequired && !inviteToken) {
          setError('Нужна ссылка-приглашение')
          return
        }
        setPending(true)
        setError(null)
        setNotice(null)
        setRemember(nextRemember)
        void registerEditor(email, password, projectName, projectCode, inviteToken, nextRemember)
          .then((result) => {
            if ('needsOtp' in result && result.needsOtp) {
              setCreatedCode(result.projectCode ?? null)
              setOtpEmail(result.email)
              setNotice('Код отправили на почту.')
              return
            }
            const dest = next.startsWith('/app/projects/')
              ? next
              : result.projectCode
                ? `/app/projects/${result.projectCode}`
                : '/app'
            navigate(dest.startsWith('/') ? dest : '/app', { replace: true })
          })
          .catch((err) => setError(err instanceof Error ? err.message : 'Не удалось зарегистрироваться'))
          .finally(() => setPending(false))
      }}
      onVerifyOtp={(code) => {
        if (!otpEmail) return
        setPending(true)
        setError(null)
        void verifyAuthOtp(otpEmail, 'register', code, remember)
          .then(() => {
            const dest = next.startsWith('/app/projects/')
              ? next
              : createdCode
                ? `/app/projects/${createdCode}`
                : '/app'
            navigate(dest.startsWith('/') ? dest : '/app', { replace: true })
          })
          .catch((err) => setError(err instanceof Error ? err.message : 'Неверный код'))
          .finally(() => setPending(false))
      }}
      onResendOtp={() => {
        if (!otpEmail) return
        setPending(true)
        setError(null)
        void resendAuthOtp(otpEmail, 'register')
          .then(() => setNotice('Отправили новый код.'))
          .catch((err) => setError(err instanceof Error ? err.message : 'Не удалось отправить код'))
          .finally(() => setPending(false))
      }}
    />
  )
}
