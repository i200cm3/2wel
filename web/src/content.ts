import { DJINAL_PROPERTY } from './data/djinalProperty'
import {
  DEFAULT_MENU_HINT,
  DEFAULT_MENU_TITLE,
  DEFAULT_WHATSAPP_HREF,
  buildMenuLinkHref,
  normalizeMenuCopy,
  parseMenuLinkHref,
  type BranchId,
  type MenuCopy,
  type PropertyBrand,
  type PropertyConfig,
} from './types/story'

export type {
  BranchId,
  EasingPreset,
  MotionPreset,
  PropertyConfig,
  StoryClip,
  StorySequence,
} from './types/story'
export {
  DEFAULT_EASING,
  EASING_LABELS,
  EASING_PRESETS,
  MOTION_LABELS,
  MOTION_PRESETS,
  newClipId,
  pathFromPreset,
  sequenceDuration,
} from './types/story'

/** @deprecated используйте property.brand — оставлено для совместимости */
export const BRAND = DJINAL_PROPERTY.brand
export const DEFAULT_GUEST_NAME = DJINAL_PROPERTY.defaultGuestName

/** Первая буква заглавная в ролике: «виталий» → «Виталий». */
export function displayGuestName(name: string) {
  const text = String(name ?? '').trim()
  if (!text) return ''
  const chars = [...text]
  chars[0] = chars[0].toLocaleUpperCase('ru-RU')
  return chars.join('')
}

export function fillName(template: string, name: string) {
  const filled = displayGuestName(name)
  return template.replaceAll('{name}', filled).replaceAll('[name]', filled)
}

export function fillNameOptional(template: string | undefined, name: string) {
  return template ? fillName(template, name) : undefined
}

export function fillNameLines(lines: string[] | undefined, name: string) {
  return lines?.map((line) => fillName(line, name))
}

export function resolveMenuCopy(
  copy: MenuCopy | undefined,
  brandName: string,
  guestName: string,
) {
  const c = normalizeMenuCopy(copy)
  const line = (show: boolean, text: string | undefined, fallback: string) => {
    if (!show) return undefined
    const raw = text === undefined ? fallback : text
    const filled = fillName(raw, guestName).replaceAll('{brand}', brandName).trim()
    return filled || undefined
  }
  return {
    kicker: line(c.showKicker !== false, c.kicker, brandName),
    title: line(c.showTitle !== false, c.title, DEFAULT_MENU_TITLE),
    hint: line(c.showHint !== false, c.hint, DEFAULT_MENU_HINT),
  }
}

export function greetingText(name: string, property: PropertyConfig = DJINAL_PROPERTY) {
  const title = property.sequences.greeting?.title ?? 'Здравствуйте, {name}!'
  return fillName(title, name)
}

export function brandPhoneDigits(brand: Pick<PropertyBrand, 'whatsAppNumber'>) {
  return (brand.whatsAppNumber?.trim() || '').replace(/\D/g, '')
}

export function brandTel(brand: Pick<PropertyBrand, 'phoneTel'>) {
  return brand.phoneTel?.trim() || ''
}

export function brandTelegram(brand: Pick<PropertyBrand, 'telegramUsername'>) {
  return (brand.telegramUsername?.trim() || '')
    .replace(/^(?:https?:\/\/)?(?:www\.)?t\.me\//i, '')
    .replace(/^@+/, '')
}

export function brandMax(brand: Pick<PropertyBrand, 'maxUsername'>) {
  return (brand.maxUsername?.trim() || '')
    .replace(/^(?:https?:\/\/)?(?:www\.)?max\.ru\//i, '')
    .replace(/^@+/, '')
}

export type MenuLinkVars = {
  name: string
  brand: string
  phone: string
  telegram: string
  max: string
  tel: string
}

/** Подстановка без кодирования — для частей ссылки, которые кодируются потом. */
export function fillLinkVars(value: string, vars: MenuLinkVars) {
  return value
    .replaceAll('{phone}', vars.phone)
    .replaceAll('{telegram}', vars.telegram)
    .replaceAll('{max}', vars.max)
    .replaceAll('{tel}', vars.tel)
    .replaceAll('{brand}', vars.brand)
    .replaceAll('[name]', vars.name)
    .replaceAll('{name}', vars.name)
}

export function fillMenuLinkHref(href: string, vars: MenuLinkVars) {
  const trimmed = href.trim()
  const q = trimmed.indexOf('?')
  const fill = (s: string, encode: boolean) => {
    const val = (v: string) => (encode ? encodeURIComponent(v) : v)
    return s
      .replaceAll('{phone}', val(vars.phone))
      .replaceAll('{telegram}', val(vars.telegram))
      .replaceAll('{max}', val(vars.max))
      .replaceAll('{tel}', val(vars.tel))
      .replaceAll('{brand}', val(vars.brand))
      .replaceAll('[name]', val(vars.name))
      .replaceAll('{name}', val(vars.name))
  }
  if (q === -1) return fill(trimmed, false)
  return `${fill(trimmed.slice(0, q), false)}?${fill(trimmed.slice(q + 1), true)}`
}

export function isSafeMenuHref(href: string) {
  const t = href.trim()
  if (!t) return false
  if (/^(javascript|data|vbscript|file):/i.test(t)) return false
  const scheme = t.match(/^(tel|sms|mailto|tg):/i)
  if (scheme) return t.length > scheme[0].length
  try {
    const u = new URL(t)
    return (u.protocol === 'http:' || u.protocol === 'https:') && Boolean(u.host)
  } catch {
    return false
  }
}

export function resolveMenuLinkHref(
  href: string,
  guestName: string,
  property: PropertyConfig,
) {
  const vars = {
    name: guestName,
    brand: property.brand.fullName,
    phone: brandPhoneDigits(property.brand),
    telegram: brandTelegram(property.brand),
    max: brandMax(property.brand),
    tel: brandTel(property.brand),
  }
  const parts = parseMenuLinkHref(href)
  const filled =
    parts.kind === 'other'
      ? fillMenuLinkHref(href, vars)
      : buildMenuLinkHref(
          {
            kind: parts.kind,
            target: fillLinkVars(parts.target, vars),
            text: fillLinkVars(parts.text, vars),
          },
          true,
        )
  return isSafeMenuHref(filled) ? filled : null
}

export function openMenuHref(href: string) {
  const lower = href.trim().toLowerCase()
  if (lower.startsWith('tel:') || lower.startsWith('sms:') || lower.startsWith('mailto:')) {
    window.location.assign(href)
    return
  }
  window.open(href, '_blank', 'noopener,noreferrer')
}

export function whatsAppHref(guestName: string, property: PropertyConfig = DJINAL_PROPERTY) {
  return resolveMenuLinkHref(DEFAULT_WHATSAPP_HREF, guestName, property) ?? 'https://wa.me/'
}

export function mediaLibrarySrcs(property: PropertyConfig) {
  return property.mediaLibrary.flatMap(({ folder, count }) =>
    Array.from({ length: count }, (_, i) => {
      const n = String(i + 1).padStart(2, '0')
      return `/media/${folder}/${n}.jpg`
    }),
  )
}

export function isBranchId(id: string): id is BranchId {
  return id === 'rooms' || id === 'treatment' || id === 'leisure' || id === 'fun'
}
