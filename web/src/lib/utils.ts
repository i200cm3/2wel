import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Скрывает секрет после префикса: pk_live_8983f1bb… */
export function maskPkLive(value: string) {
  return String(value ?? '').replace(/(pk_live_[a-fA-F0-9]{8})[a-fA-F0-9]+/gi, '$1…')
}

/** Кабинет и API. Гостевые ссылки — `{code}.2wel.ru`. */
export const PUBLIC_SITE_ORIGIN = 'https://2wel.ru'
export const GUEST_BASE_DOMAIN = '2wel.ru'
export const SUPPORT_EMAIL = 'support@2wel.ru'

export function supportMailHref(subject: string): string {
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`
}

export function publicShareUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`
  return `${PUBLIC_SITE_ORIGIN}${p}`
}

/** Ссылка для гостя: https://djinal.2wel.ru/xxxx */
export function guestShareUrl(projectCode: string, pathOrUrl: string): string {
  const raw = String(pathOrUrl ?? '').trim()
  if (!raw) return ''
  if (/^https?:\/\//i.test(raw)) return raw
  const id = raw.replace(/^\/+/, '')
  const code = String(projectCode ?? '').trim().toLowerCase()
  if (!code) return publicShareUrl(`/${id}`)
  return `https://${code}.${GUEST_BASE_DOMAIN}/${id}`
}
