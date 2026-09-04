import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { BrandLogo } from '@/components/BrandLogo'
import { LoginForm, type LoginFormMode } from '@/components/login-form'
import { ModeToggle } from '@/components/ModeToggle'

type Props = {
  mode?: LoginFormMode
  error?: string | null
  notice?: string | null
  pending?: boolean
  invite?: string
  inviteRequired?: boolean
  onLogin?: (email: string, password: string, remember: boolean) => void
  onRegister?: (
    email: string,
    password: string,
    projectName: string,
    projectCode: string,
    invite: string,
    remember: boolean,
  ) => void
  onForgot?: (email: string) => void
  onReset?: (password: string) => void
  otpEmail?: string
  onVerifyOtp?: (code: string) => void
  onResendOtp?: () => void
}

/** Макет [login-01](https://ui.shadcn.com/blocks/login): форма по центру, переключатель темы. */
export function EditorLoginPage({
  mode = 'login',
  error,
  notice,
  pending,
  invite,
  inviteRequired,
  onLogin,
  onRegister,
  onForgot,
  onReset,
  otpEmail,
  onVerifyOtp,
  onResendOtp,
}: Props) {
  useEffect(() => {
    document.documentElement.classList.add('login-open')
    return () => document.documentElement.classList.remove('login-open')
  }, [])

  return (
    <div className="bg-background text-foreground relative flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="absolute top-4 right-4">
        <ModeToggle />
      </div>
      <div className="flex w-full max-w-sm flex-col items-center gap-6">
        <Link to="/" className="block overflow-hidden rounded-lg" aria-label="2wel — на главную">
          <BrandLogo size="lg" />
        </Link>
        <LoginForm
          className="w-full"
          mode={mode}
          error={error}
          notice={notice}
          pending={pending}
          invite={invite}
          inviteRequired={inviteRequired}
          onLogin={onLogin}
          onRegister={onRegister}
          onForgot={onForgot}
          onReset={onReset}
          otpEmail={otpEmail}
          onVerifyOtp={onVerifyOtp}
          onResendOtp={onResendOtp}
        />
      </div>
    </div>
  )
}
