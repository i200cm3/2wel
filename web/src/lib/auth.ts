const TOKEN_KEY = 'promo-editor-token'

function storageGet(key: string) {
  try {
    return localStorage.getItem(key) ?? sessionStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}

function storageClear(key: string) {
  try {
    sessionStorage.removeItem(key)
    localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}

/** Остаток Bearer из старых сессий. Новые логины кладут httpOnly cookie. */
export function getEditorToken(): string {
  return storageGet(TOKEN_KEY)
}

export function clearEditorToken() {
  storageClear(TOKEN_KEY)
}

export function authHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra)
  const token = getEditorToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  return headers
}

export function authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, {
    ...init,
    headers: authHeaders(init?.headers),
    credentials: 'include',
  })
}

export type OtpPurpose = 'register' | 'login' | 'reset'

export type OtpChallenge = {
  needsOtp: true
  email: string
  purpose: OtpPurpose
  projectCode?: string | null
  message?: string
}

export async function loginEditor(
  email: string,
  password: string,
  remember = false,
): Promise<OtpChallenge | void> {
  let res: Response
  try {
    res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password, remember }),
    })
  } catch {
    throw new Error('Сервер входа недоступен. Запустите API на :3000.')
  }
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean
    error?: string
    needsOtp?: boolean
    email?: string
    purpose?: OtpPurpose
  }
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Не удалось войти')
  }
  if (data.needsOtp && data.email && data.purpose) {
    return { needsOtp: true, email: data.email, purpose: data.purpose }
  }
  clearEditorToken()
}

export async function registerEditor(
  email: string,
  password: string,
  projectName: string,
  projectCode: string,
  invite?: string,
  remember = false,
): Promise<{ projectCode: string | null } | OtpChallenge> {
  const res = await fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email, password, projectName, projectCode, invite, remember }),
  })
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean
    error?: string
    needsOtp?: boolean
    email?: string
    purpose?: OtpPurpose
    project?: { code?: string }
  }
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Не удалось зарегистрироваться')
  }
  if (data.needsOtp && data.email) {
    return {
      needsOtp: true,
      email: data.email,
      purpose: data.purpose === 'login' || data.purpose === 'reset' ? data.purpose : 'register',
      projectCode: data.project?.code ?? null,
    }
  }
  clearEditorToken()
  return { projectCode: data.project?.code ?? null }
}

export type SessionUser = {
  id: string
  login: string
  email: string | null
  name: string
  isAdmin: boolean
}

export type RegistrationInfo = {
  mode: 'open' | 'invite' | 'closed'
  open: boolean
  invite: boolean
  canInvite?: boolean
}

export async function fetchRegistration(): Promise<RegistrationInfo> {
  const res = await fetch('/api/auth/registration', { cache: 'no-store', credentials: 'include' })
  const data = (await res.json().catch(() => ({}))) as Partial<RegistrationInfo>
  const mode = data.mode === 'invite' || data.mode === 'closed' || data.mode === 'open' ? data.mode : 'open'
  return { mode, open: mode === 'open', invite: mode === 'invite' }
}

export async function requestPasswordReset(email: string): Promise<OtpChallenge> {
  const res = await fetch('/api/auth/forgot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email }),
  })
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean
    error?: string
    message?: string
    needsOtp?: boolean
    email?: string
    purpose?: OtpPurpose
  }
  if (!res.ok) throw new Error(data.error || 'Не удалось запросить сброс')
  return {
    needsOtp: true,
    email: data.email || email,
    purpose: 'reset',
    message: data.message || 'Если такая почта есть, отправим код из 4 цифр.',
  }
}

export async function verifyAuthOtp(
  email: string,
  purpose: OtpPurpose,
  code: string,
  remember = true,
): Promise<{ resetToken?: string }> {
  const res = await fetch('/api/auth/otp/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email, purpose, code, remember }),
  })
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean
    error?: string
    resetToken?: string
  }
  if (!res.ok || !data.ok) throw new Error(data.error || 'Неверный код')
  if (purpose !== 'reset') clearEditorToken()
  return { resetToken: data.resetToken }
}

export async function resendAuthOtp(email: string, purpose: OtpPurpose): Promise<void> {
  const res = await fetch('/api/auth/otp/resend', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email, purpose }),
  })
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
  if (!res.ok || !data.ok) throw new Error(data.error || 'Не удалось отправить код')
}

export async function resetPassword(token: string, password: string): Promise<void> {
  const res = await fetch('/api/auth/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ token, password }),
  })
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
  if (!res.ok || !data.ok) throw new Error(data.error || 'Не удалось сменить пароль')
  clearEditorToken()
}

async function authJson<T>(path: string, method: string, body?: unknown): Promise<T> {
  const res = await authFetch(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  })
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (res.status === 401) {
    clearEditorToken()
    throw new Error(data.error || 'unauthorized')
  }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await authJson<{ ok: true }>('/api/auth/password', 'POST', { currentPassword, newPassword })
}

export type Invite = {
  id: string
  email: string | null
  createdAt: string
  expiresAt: string
  usedAt: string | null
  token?: string
}

export function fetchInvites() {
  return authJson<{ ok: true } & RegistrationInfo & { canInvite: boolean; invites: Invite[] }>(
    '/api/auth/invites',
    'GET',
  )
}

export function createInvite(email?: string) {
  return authJson<{ ok: true; invite: Invite }>('/api/auth/invites', 'POST', { email: email ?? '' })
}

export async function fetchSessionUser(): Promise<SessionUser | null> {
  const hadLegacy = Boolean(getEditorToken())
  let res = await authFetch('/api/auth/me', { cache: 'no-store' })
  if (!res.ok && hadLegacy) {
    clearEditorToken()
    res = await authFetch('/api/auth/me', { cache: 'no-store' })
  }
  if (!res.ok) {
    clearEditorToken()
    return null
  }
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; user?: SessionUser }
  if (!data.user) {
    clearEditorToken()
    return null
  }
  return { ...data.user, isAdmin: Boolean(data.user.isAdmin) }
}

export async function editorSessionOk(): Promise<boolean> {
  return Boolean(await fetchSessionUser())
}

export async function logoutEditor() {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
  } catch {
    /* ignore */
  }
  clearEditorToken()
}
