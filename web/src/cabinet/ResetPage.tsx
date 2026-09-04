import { useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { EditorLoginPage } from '@/components/EditorLoginPage'
import { resetPassword } from '@/lib/auth'

export function ResetPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const token = params.get('token') || ''
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!token) {
    return <Navigate to="/forgot" replace />
  }

  return (
    <EditorLoginPage
      mode="reset"
      error={error}
      pending={pending}
      onReset={(password) => {
        setPending(true)
        setError(null)
        void resetPassword(token, password)
          .then(() => navigate('/app', { replace: true }))
          .catch((err) => setError(err instanceof Error ? err.message : 'Не удалось сменить пароль'))
          .finally(() => setPending(false))
      }}
    />
  )
}
