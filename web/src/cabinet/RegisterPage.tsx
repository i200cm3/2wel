import { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { EditorLoginPage } from '@/components/EditorLoginPage'
import { fetchProjects } from '@/lib/api'
import { fetchRegistration, fetchSessionUser, registerEditor, resendAuthOtp, verifyAuthOtp } from '@/lib/auth'

/** Всегда в объект с welcome — не через /app (AppIndex иначе срежет query). */
function postRegisterPath(projectCode: string | null | undefined) {
  const code = String(projectCode ?? '')
    .trim()
    .toLowerCase()
  if (!code) return '/app'
  return `/app/projects/${encodeURIComponent(code)}?welcome=1`
}

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
  const createdCodeRef = useRef<string | null>(null)

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

  const goToProject = async (preferred?: string | null) => {
    let code =
      String(preferred ?? '').trim().toLowerCase() || createdCodeRef.current
    if (!code) {
      try {
        const list = await fetchProjects()
        code = list.projects[0]?.code ?? null
      } catch {
        code = null
      }
    }
    if (code) createdCodeRef.current = code
    navigate(postRegisterPath(code), { replace: true })
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
        const normalized = projectCode.trim().toLowerCase() || null
        createdCodeRef.current = normalized
        setPending(true)
        setError(null)
        setNotice(null)
        setRemember(nextRemember)
        void registerEditor(email, password, projectName, projectCode, inviteToken, nextRemember)
          .then((result) => {
            if ('needsOtp' in result && result.needsOtp) {
              createdCodeRef.current = result.projectCode ?? normalized
              setOtpEmail(result.email)
              setNotice('Код отправили на почту.')
              return
            }
            return goToProject(result.projectCode ?? normalized)
          })
          .catch((err) => setError(err instanceof Error ? err.message : 'Не удалось зарегистрироваться'))
          .finally(() => setPending(false))
      }}
      onVerifyOtp={(code) => {
        if (!otpEmail) return
        setPending(true)
        setError(null)
        void verifyAuthOtp(otpEmail, 'register', code, remember)
          .then(() => goToProject(createdCodeRef.current))
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
