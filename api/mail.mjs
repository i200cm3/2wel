import nodemailer from 'nodemailer'

/** Пароли, которые когда-либо попадали в .env.example / переписку — API не стартует с ними. */
const LEAKED_SMTP_PASSES = new Set(['950201712Wel'])

export function mailEnv() {
  const user = String(process.env.SMTP_USER ?? process.env.MAIL_FROM ?? 'support@2wel.ru').trim()
  const from = String(process.env.MAIL_FROM ?? user).trim() || user
  const port = Number(process.env.SMTP_PORT || 465)
  const secureFlag = String(process.env.SMTP_SECURE ?? '').trim().toLowerCase()
  return {
    host: String(process.env.SMTP_HOST ?? 'smtp.spaceweb.ru').trim() || 'smtp.spaceweb.ru',
    port: Number.isFinite(port) && port > 0 ? port : 465,
    secure: secureFlag === '0' || secureFlag === 'false' ? false : port === 465 || secureFlag === '1',
    user,
    pass: String(process.env.SMTP_PASS ?? '').trim(),
    from,
    fromName: String(process.env.MAIL_FROM_NAME ?? '2wel').trim() || '2wel',
  }
}

export function isLeakedSmtpPass(pass) {
  return LEAKED_SMTP_PASSES.has(String(pass ?? '').trim())
}

/** Падать при старте API, если SMTP_PASS из списка скомпрометированных. */
export function assertSmtpPassSafe() {
  const pass = mailEnv().pass
  if (!pass || !isLeakedSmtpPass(pass)) return
  console.error(
    'SMTP_PASS скомпрометирован (ранее был в .env.example). Смените пароль ящика в панели SpaceWeb и обновите SMTP_PASS в .env.',
  )
  process.exit(1)
}

export function smtpReady(env = mailEnv()) {
  return Boolean(env.host && env.user && env.pass && env.from && !isLeakedSmtpPass(env.pass))
}

export function formatFrom(env = mailEnv()) {
  const name = env.fromName.replace(/["\r\n]/g, '')
  return name ? `"${name}" <${env.from}>` : env.from
}

export function passwordResetMail({ to, link, env = mailEnv() }) {
  const text = [
    'Ссылка, чтобы задать новый пароль в кабинете 2wel (действует 2 часа):',
    '',
    link,
    '',
    'Если вы не запрашивали сброс, просто удалите письмо.',
  ].join('\n')
  const safeLink = String(link).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
  const html = `<p>Ссылка, чтобы задать новый пароль в кабинете 2wel (действует 2 часа):</p>
<p><a href="${safeLink}">${safeLink}</a></p>
<p>Если вы не запрашивали сброс, просто удалите письмо.</p>`
  return {
    from: formatFrom(env),
    to,
    subject: 'Сброс пароля 2wel',
    text,
    html,
  }
}

const OTP_SUBJECT = {
  register: 'Код подтверждения 2wel',
  login: 'Код входа 2wel',
  reset: 'Код сброса пароля 2wel',
}

export function otpMail({ to, code, purpose, env = mailEnv() }) {
  const digits = String(code ?? '').replace(/\D/g, '').slice(0, 4)
  const text = [
    `Код подтверждения 2wel: ${digits}`,
    '',
    'Действует 10 минут. Если вы не запрашивали код, удалите письмо.',
  ].join('\n')
  const html = `<p>Код подтверждения 2wel:</p>
<p style="font-size:28px;letter-spacing:8px;font-family:Arial,Helvetica,sans-serif;font-weight:bold;">${digits}</p>
<p>Действует 10 минут. Если вы не запрашивали код, удалите письмо.</p>`
  return {
    from: formatFrom(env),
    to,
    subject: OTP_SUBJECT[purpose] || 'Код подтверждения 2wel',
    text,
    html,
  }
}

let transporter

function transportFor(env) {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.host,
      port: env.port,
      secure: env.secure,
      auth: { user: env.user, pass: env.pass },
    })
  }
  return transporter
}

export async function sendPasswordResetMail(to, link) {
  return sendMail(passwordResetMail({ to, link }))
}

export async function sendOtpMail(to, code, purpose) {
  const address = String(to ?? '').trim()
  if (!address) return { ok: false, skipped: true, error: 'no recipient' }
  return sendMail(otpMail({ to: address, code, purpose }))
}

export function demoGuestMail({ to, name, link, env = mailEnv() }) {
  const guest = String(name ?? '').trim() || 'гость'
  const text = [
    `${guest}, здравствуйте!`,
    '',
    'Ваша персональная демо-страница 2wel:',
    '',
    link,
    '',
    'Откройте ссылку с телефона — так её обычно видит гость.',
    '',
    'Если письмо пришло случайно, просто удалите его.',
  ].join('\n')
  const safeLink = String(link).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
  const safeName = String(guest).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  const html = `<p>${safeName}, здравствуйте!</p>
<p>Ваша персональная демо-страница 2wel:</p>
<p><a href="${safeLink}">${safeLink}</a></p>
<p>Откройте ссылку с телефона — так её обычно видит гость.</p>
<p>Если письмо пришло случайно, просто удалите его.</p>`
  return {
    from: formatFrom(env),
    to,
    subject: 'Ваша демо-страница 2wel',
    text,
    html,
  }
}

export async function sendDemoGuestMail(to, { name, link }) {
  const address = String(to ?? '').trim()
  if (!address) return { ok: false, skipped: true, error: 'no recipient' }
  if (!link) return { ok: false, skipped: true, error: 'no link' }
  return sendMail(demoGuestMail({ to: address, name, link }))
}

async function sendMail(message) {
  const env = mailEnv()
  if (!smtpReady(env)) return { ok: false, skipped: true, error: 'smtp not configured' }
  try {
    await transportFor(env).sendMail({ ...message, from: message.from || formatFrom(env) })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }
}
