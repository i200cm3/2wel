import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { EditorLoginPage } from '@/components/EditorLoginPage'
import { requestPasswordReset, resendAuthOtp, verifyAuthOtp } from '@/lib/auth'

export function ForgotPage() {
  const navigate = useNavigate()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [otpEmail, setOtpEmail] = useState<string | null>(null)

  return (
    <EditorLoginPage
      mode={otpEmail ? 'otp' : 'forgot'}
      otpEmail={otpEmail ?? ''}
      error={error}
      notice={notice}
      pending={pending}
      onForgot={(email) => {
        setPending(true)
        setError(null)
        setNotice(null)
        void requestPasswordReset(email)
          .then((challenge) => {
            setOtpEmail(challenge.email)
            setNotice(challenge.message ?? 'Код отправили на почту.')
          })
          .catch((err) => setError(err instanceof Error ? err.message : 'Не удалось запросить сброс'))
          .finally(() => setPending(false))
      }}
      onVerifyOtp={(code) => {
        if (!otpEmail) return
        setPending(true)
        setError(null)
        void verifyAuthOtp(otpEmail, 'reset', code)
          .then(({ resetToken }) => {
            if (!resetToken) throw new Error('Не удалось подтвердить код')
            navigate(`/reset?token=${encodeURIComponent(resetToken)}`, { replace: true })
          })
          .catch((err) => setError(err instanceof Error ? err.message : 'Неверный код'))
          .finally(() => setPending(false))
      }}
      onResendOtp={() => {
        if (!otpEmail) return
        setPending(true)
        setError(null)
        void resendAuthOtp(otpEmail, 'reset')
          .then(() => setNotice('Отправили новый код.'))
          .catch((err) => setError(err instanceof Error ? err.message : 'Не удалось отправить код'))
          .finally(() => setPending(false))
      }}
    />
  )
}
