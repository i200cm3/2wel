import { useState, type ComponentProps } from "react"
import { Link } from "react-router-dom"
import { cn, GUEST_BASE_DOMAIN } from "@/lib/utils"
import { slugifyProjectCode, validateProjectCode } from "@/lib/projectCode"
import { REGEXP_ONLY_DIGITS } from "input-otp"
import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp"

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MIN_PASSWORD = 8

function isEmail(value: string) {
  const email = value.trim()
  return email.length <= 254 && EMAIL_RE.test(email)
}

function isLoginIdentity(value: string, mode: LoginFormMode) {
  const identity = value.trim()
  if (!identity) return false
  if (mode === 'login') return identity.length >= 2
  return isEmail(identity)
}

export type LoginFormMode = "login" | "register" | "forgot" | "reset" | "closed" | "otp"

type LoginFormProps = Omit<ComponentProps<"div">, "onReset"> & {
  mode?: LoginFormMode
  error?: string | null
  notice?: string | null
  pending?: boolean
  invite?: string
  inviteRequired?: boolean
  otpEmail?: string
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
  onVerifyOtp?: (code: string) => void
  onResendOtp?: () => void
}

const COPY: Record<LoginFormMode, { title: string; description: string }> = {
  login: { title: "Вход в кабинет", description: "Почта или логин и пароль учётки" },
  register: { title: "Регистрация", description: "Аккаунт и первый объект размещения" },
  forgot: { title: "Сброс пароля", description: "Укажите почту — пришлём код из 4 цифр с support@2wel.ru" },
  reset: { title: "Новый пароль", description: "Не короче 8 символов" },
  otp: { title: "Код из письма", description: "Четыре цифры с support@2wel.ru, 10 минут" },
  closed: { title: "Регистрация закрыта", description: "Аккаунт выдаёт администратор" },
}

export function LoginForm({
  className,
  mode = "login",
  error,
  notice,
  pending,
  invite = "",
  inviteRequired = false,
  otpEmail = "",
  onLogin,
  onRegister,
  onForgot,
  onReset,
  onVerifyOtp,
  onResendOtp,
  ...props
}: LoginFormProps) {
  const [email, setEmail] = useState("")
  const [otp, setOtp] = useState("")
  const [projectName, setProjectName] = useState("")
  const [projectCode, setProjectCode] = useState("")
  const [codeTouched, setCodeTouched] = useState(false)
  const emailInvalid = email.length > 0 && !isLoginIdentity(email, mode)
  const formatCheck = validateProjectCode(projectCode)
  const codeInvalid = mode === "register" && projectCode.length > 0 && !formatCheck.ok
  const copy = COPY[mode]

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card className="text-base [--card-spacing:--spacing(6)]">
        <CardHeader>
          <CardTitle className="font-sans text-xl leading-none font-semibold tracking-tight">
            {copy.title}
          </CardTitle>
          <CardDescription className="text-sm">{copy.description}</CardDescription>
        </CardHeader>
        <CardContent>
          {mode === "closed" ? (
            <FieldGroup>
              <FieldDescription className="text-sm">
                Самостоятельная регистрация отключена. Войдите, если аккаунт уже есть, или попросите
                приглашение.
              </FieldDescription>
              <Button nativeButton={false} render={<Link to="/login" />} className="w-full text-sm">
                Войти
              </Button>
            </FieldGroup>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault()
                const data = new FormData(event.currentTarget)
                const nextEmail = String(data.get("email") ?? "").trim()
                const password = String(data.get("password") ?? "")
                const projectName = String(data.get("projectName") ?? "")
                const projectCode = String(data.get("projectCode") ?? "").trim().toLowerCase()
                const remember = data.get("remember") === "on"
                const inviteValue = String(data.get("invite") ?? invite).trim()
                if (mode === "forgot") {
                  if (!isEmail(nextEmail)) return
                  onForgot?.(nextEmail)
                  return
                }
                if (mode === "otp") {
                  if (otp.length !== 4) return
                  onVerifyOtp?.(otp)
                  return
                }
                if (mode === "reset") {
                  onReset?.(password)
                  return
                }
                if (!isLoginIdentity(nextEmail, mode)) return
                if (mode === "register") {
                  if (inviteRequired && !inviteValue) return
                  if (!validateProjectCode(projectCode).ok) return
                  onRegister?.(nextEmail, password, projectName, projectCode, inviteValue, remember)
                } else {
                  onLogin?.(nextEmail, password, remember)
                }
              }}
            >
              <FieldGroup>
                {mode === "otp" ? (
                  <>
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
                        aria-invalid={error ? true : undefined}
                        onComplete={(value) => {
                          if (!pending && value.length === 4) onVerifyOtp?.(value)
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
                        Код отправили на {otpEmail || "указанную почту"}
                      </FieldDescription>
                    </Field>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => onResendOtp?.()}
                      className="w-full text-sm"
                    >
                      <RefreshCw aria-hidden />
                      Отправить код ещё раз
                    </Button>
                  </>
                ) : null}
                {mode === "register" ? (
                  <>
                  <Field>
                    <FieldLabel htmlFor="projectName" className="text-sm">
                      Название объекта
                    </FieldLabel>
                    <Input
                      id="projectName"
                      name="projectName"
                      type="text"
                      autoComplete="organization"
                      placeholder="Название объекта"
                      required
                      value={projectName}
                      onChange={(event) => {
                        const next = event.target.value
                        setProjectName(next)
                        if (!codeTouched) setProjectCode(slugifyProjectCode(next))
                      }}
                      disabled={pending}
                      className="h-9 text-sm"
                    />
                  </Field>
                  <Field data-invalid={codeInvalid || undefined}>
                    <FieldLabel htmlFor="projectCode" className="text-sm">
                      Адрес ссылок
                    </FieldLabel>
                    <div className="flex items-center gap-1">
                      <Input
                        id="projectCode"
                        name="projectCode"
                        value={projectCode}
                        onChange={(event) => {
                          setCodeTouched(true)
                          setProjectCode(event.target.value.toLowerCase())
                        }}
                        placeholder="hotel"
                        required
                        autoCapitalize="off"
                        autoCorrect="off"
                        spellCheck={false}
                        disabled={pending}
                        aria-invalid={codeInvalid || undefined}
                        className="h-9 font-mono text-sm"
                      />
                      <span className="text-muted-foreground shrink-0 text-sm">.{GUEST_BASE_DOMAIN}</span>
                    </div>
                    <FieldError>{codeInvalid && !formatCheck.ok ? formatCheck.error : null}</FieldError>
                    <FieldDescription className="text-xs">
                      Гостевые ссылки: https://{formatCheck.ok ? formatCheck.code : "plaza"}.{GUEST_BASE_DOMAIN}/xxxx
                    </FieldDescription>
                  </Field>
                  </>
                ) : null}
                {mode === "register" && inviteRequired ? (
                  <Field>
                    <FieldLabel htmlFor="invite" className="text-sm">
                      Приглашение
                    </FieldLabel>
                    <Input
                      id="invite"
                      name="invite"
                      type="text"
                      defaultValue={invite}
                      required={!invite}
                      disabled={pending || Boolean(invite)}
                      className="h-9 text-sm"
                    />
                  </Field>
                ) : invite ? (
                  <input type="hidden" name="invite" value={invite} />
                ) : null}
                {mode !== "reset" && mode !== "otp" ? (
                  <Field data-invalid={emailInvalid || undefined}>
                    <FieldLabel htmlFor="email" className="text-sm">
                      {mode === "login" ? "Почта или логин" : "Почта"}
                    </FieldLabel>
                    <Input
                      id="email"
                      name="email"
                      type={mode === "login" ? "text" : "email"}
                      autoComplete="username"
                      inputMode="email"
                      placeholder={mode === "login" ? "admin@promo.local" : "hotel@example.com"}
                      required
                      value={email}
                      aria-invalid={emailInvalid || undefined}
                      onChange={(event) => setEmail(event.target.value)}
                      disabled={pending}
                      className="h-9 text-sm"
                    />
                    {emailInvalid ? (
                      <FieldError>
                        {mode === "login" ? "Укажите почту или логин" : "Укажите корректный email"}
                      </FieldError>
                    ) : null}
                  </Field>
                ) : null}
                {mode === "login" || mode === "register" || mode === "reset" ? (
                  <Field>
                    <FieldLabel htmlFor="password" className="text-sm">
                      {mode === "reset" ? "Новый пароль" : "Пароль"}
                    </FieldLabel>
                    <Input
                      id="password"
                      name="password"
                      type="password"
                      autoComplete={mode === "login" ? "current-password" : "new-password"}
                      required
                      minLength={mode === "login" ? 6 : MIN_PASSWORD}
                      disabled={pending}
                      className="h-9 text-sm"
                    />
                  </Field>
                ) : null}
                {mode === "login" || mode === "register" ? (
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      name="remember"
                      defaultChecked
                      className="size-4 accent-primary"
                      disabled={pending}
                    />
                    Запомнить меня
                  </label>
                ) : null}
                {notice ? (
                  <FieldDescription className="text-sm">{notice}</FieldDescription>
                ) : null}
                {error ? (
                  <FieldDescription className="text-destructive text-sm">{error}</FieldDescription>
                ) : null}
                <Field>
                  <Button
                    type="submit"
                    size="lg"
                    disabled={
                      pending ||
                      (mode === "otp" && otp.length !== 4) ||
                      (mode !== "reset" && mode !== "otp" && emailInvalid) ||
                      (mode === "register" && !formatCheck.ok)
                    }
                    className="w-full text-sm"
                  >
                    {pending
                      ? mode === "register"
                        ? "Настраиваю адрес…"
                        : mode === "forgot"
                          ? "Отправка…"
                          : mode === "otp"
                            ? "Проверяю…"
                          : mode === "reset"
                            ? "Сохранение…"
                            : "Вход…"
                      : mode === "register"
                        ? "Создать аккаунт"
                        : mode === "forgot"
                          ? "Выслать код"
                          : mode === "otp"
                            ? "Подтвердить"
                          : mode === "reset"
                            ? "Сохранить пароль"
                            : "Войти"}
                  </Button>
                  <FieldDescription className="text-center text-sm">
                    {mode === "register" ? (
                      <>
                        Уже есть аккаунт?{" "}
                        <Link to="/login" className="text-primary underline-offset-4 hover:underline">
                          Войти
                        </Link>
                      </>
                    ) : mode === "forgot" || mode === "reset" || mode === "otp" ? (
                      <>
                        Вспомнили пароль?{" "}
                        <Link to="/login" className="text-primary underline-offset-4 hover:underline">
                          Войти
                        </Link>
                      </>
                    ) : (
                      <>
                        <Link to="/forgot" className="text-primary underline-offset-4 hover:underline">
                          Забыли пароль?
                        </Link>
                        {inviteRequired || mode === "login" ? (
                          <>
                            {" · "}
                            <Link to="/register" className="text-primary underline-offset-4 hover:underline">
                              Регистрация
                            </Link>
                          </>
                        ) : null}
                      </>
                    )}
                  </FieldDescription>
                </Field>
              </FieldGroup>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
