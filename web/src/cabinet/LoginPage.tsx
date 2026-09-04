import { useEffect, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { EditorLoginPage } from '@/components/EditorLoginPage'
import { fetchSessionUser, loginEditor, resendAuthOtp, verifyAuthOtp } from '@/lib/auth'

export function LoginPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = params.get('next') || '/app'
  const [ready, setReady] = useState(false)
  const [authed, setAuthed] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [otpEmail, setOtpEmail] = useState<string | null>(null)
  const [remember, setRemember] = useState(true)

  useEffect(() => {
    let cancelled = false
    void fetchSessionUser().then((user) => {
      if (cancelled) return
      setAuthed(Boolean(user))
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
      mode={otpEmail ? 'otp' : 'login'}
      otpEmail={otpEmail ?? ''}
      error={error}
      notice={notice}
      pending={pending}
      onLogin={(email, password, nextRemember) => {
        setPending(true)
        setError(null)
        setNotice(null)
        setRemember(nextRemember)
        void loginEditor(email, password, nextRemember)
          .then((challenge) => {
            if (challenge?.needsOtp) {
              setOtpEmail(challenge.email)
              setNotice('Код отправили на почту.')
              return
            }
            navigate(next.startsWith('/') ? next : '/app', { replace: true })
          })
          .catch((err) => setError(err instanceof Error ? err.message : 'Не удалось войти'))
          .finally(() => setPending(false))
      }}
      onVerifyOtp={(code) => {
        if (!otpEmail) return
        setPending(true)
        setError(null)
        void verifyAuthOtp(otpEmail, 'login', code, remember)
          .then(() => navigate(next.startsWith('/') ? next : '/app', { replace: true }))
          .catch((err) => setError(err instanceof Error ? err.message : 'Неверный код'))
          .finally(() => setPending(false))
      }}
      onResendOtp={() => {
        if (!otpEmail) return
        setPending(true)
        setError(null)
        void resendAuthOtp(otpEmail, 'login')
          .then(() => setNotice('Отправили новый код.'))
          .catch((err) => setError(err instanceof Error ? err.message : 'Не удалось отправить код'))
          .finally(() => setPending(false))
      }}
    />
  )
}
