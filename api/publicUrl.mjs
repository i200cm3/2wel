import { loadEnv } from './env.mjs'

const PROJECT_CODE_RE = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/

function stripHost(value) {
  return String(value ?? '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')
    .toLowerCase()
}

/** База гостевых ссылок: {code}.2wel.ru. Кабинет живёт на самом DOMAIN. */
export function guestBaseDomain() {
  loadEnv()
  const fromEnv = stripHost(process.env.GUEST_BASE_DOMAIN)
  if (fromEnv) return fromEnv
  const domain = stripHost(process.env.DOMAIN)
  return domain || '2wel.ru'
}

export function guestLinkUrl(projectCode, publicId) {
  const code = String(projectCode ?? '').trim().toLowerCase()
  const id = String(publicId ?? '')
    .trim()
    .replace(/^\/+/, '')
    .toLowerCase()
  const base = guestBaseDomain()
  if (!id) return `https://${base}/`
  if (!PROJECT_CODE_RE.test(code)) return `https://${base}/${id}`
  return `https://${code}.${base}/${id}`
}
