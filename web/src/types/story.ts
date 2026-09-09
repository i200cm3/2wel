export type MotionPreset =
  | 'none'
  | 'zoom-out'
  | 'zoom-in'
  | 'pan-left'
  | 'pan-right'
  | 'pan-up'
  | 'custom'

/** Точка фокуса камеры: x/y 0..1 относительно кадра, scale — зум. */
export type FocusPoint = {
  x: number
  y: number
  scale: number
}

export type MotionPath = {
  from: FocusPoint
  to: FocusPoint
}

export const MOTION_PRESETS: MotionPreset[] = [
  'none',
  'zoom-out',
  'zoom-in',
  'pan-left',
  'pan-right',
  'pan-up',
  'custom',
]

export const MOTION_LABELS: Record<MotionPreset, string> = {
  none: 'Без анимации',
  'zoom-out': 'Отъезд',
  'zoom-in': 'Наезд',
  'pan-left': 'Влево',
  'pan-right': 'Вправо',
  'pan-up': 'Вверх',
  custom: 'Свой путь',
}

export const DEFAULT_MOTION: MotionPreset = 'none'

/** Кривая скорости анимации (CSS animation-timing-function). */
export type EasingPreset =
  | 'linear'
  | 'ease'
  | 'ease-in'
  | 'ease-out'
  | 'ease-in-out'
  | 'ease-in-out-cubic'
  | 'ease-out-cubic'
  | 'ease-in-cubic'

export const EASING_PRESETS: EasingPreset[] = [
  'linear',
  'ease',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'ease-in-cubic',
  'ease-out-cubic',
  'ease-in-out-cubic',
]

export const EASING_LABELS: Record<EasingPreset, string> = {
  linear: 'Linear',
  ease: 'Ease',
  'ease-in': 'Ease In',
  'ease-out': 'Ease Out',
  'ease-in-out': 'Ease In-Out',
  'ease-in-cubic': 'Ease In Cubic',
  'ease-out-cubic': 'Ease Out Cubic',
  'ease-in-out-cubic': 'Ease In-Out Cubic',
}

/** CSS-значения (кубические — через cubic-bezier). */
export const EASING_CSS: Record<EasingPreset, string> = {
  linear: 'linear',
  ease: 'ease',
  'ease-in': 'ease-in',
  'ease-out': 'ease-out',
  'ease-in-out': 'ease-in-out',
  'ease-in-cubic': 'cubic-bezier(0.55, 0.06, 0.68, 0.19)',
  'ease-out-cubic': 'cubic-bezier(0.22, 0.61, 0.36, 1)',
  'ease-in-out-cubic': 'cubic-bezier(0.65, 0, 0.35, 1)',
}

export const DEFAULT_EASING: EasingPreset = 'ease-in-out'

/** Пресеты → стартовая/конечная точка (можно править мышкой). */
export const MOTION_PATHS: Record<Exclude<MotionPreset, 'custom'>, MotionPath> = {
  none: {
    from: { x: 0.5, y: 0.5, scale: 1.02 },
    to: { x: 0.5, y: 0.5, scale: 1.02 },
  },
  'zoom-out': {
    from: { x: 0.5, y: 0.5, scale: 1.18 },
    to: { x: 0.5, y: 0.5, scale: 1.02 },
  },
  'zoom-in': {
    from: { x: 0.5, y: 0.5, scale: 1.02 },
    to: { x: 0.5, y: 0.5, scale: 1.18 },
  },
  'pan-left': {
    from: { x: 0.62, y: 0.5, scale: 1.14 },
    to: { x: 0.38, y: 0.5, scale: 1.14 },
  },
  'pan-right': {
    from: { x: 0.38, y: 0.5, scale: 1.14 },
    to: { x: 0.62, y: 0.5, scale: 1.14 },
  },
  'pan-up': {
    from: { x: 0.5, y: 0.62, scale: 1.14 },
    to: { x: 0.5, y: 0.38, scale: 1.14 },
  },
}

export type BranchId = string

/** Куда ведёт кнопка в конце блока */
export type EndButtonTarget =
  | { kind: 'next' }
  | { kind: 'menu'; menuId?: string }
  | { kind: 'contact' }
  | { kind: 'sequence'; sequenceId: string }

export type EndButton = {
  id: string
  label: string
  target: EndButtonTarget
}

/** Переход при входе на этот слайд (с предыдущего). */
export type ClipTransition = 'cut' | 'dissolve'

export const CLIP_TRANSITIONS: ClipTransition[] = ['cut', 'dissolve']

export const TRANSITION_LABELS: Record<ClipTransition, string> = {
  cut: 'Без анимации',
  dissolve: 'Cross dissolve',
}

export const DEFAULT_TRANSITION: ClipTransition = 'cut'

/** Длительность dissolve между слайдами. */
export const DISSOLVE_SEC = 0.22

export type ClipMediaKind = 'image' | 'video'

export type StoryClip = {
  id: string
  src: string
  /** Явный тип медиа; если нет — выводится из расширения src */
  media?: ClipMediaKind
  /** Полная длительность исходного видео; нужна для trim-границ. */
  sourceDurationSec?: number
  /** С какой секунды исходного видео начинать воспроизведение. */
  trimStartSec?: number
  motion: MotionPreset
  /** Сколько слайд висит до следующего */
  durationSec: number
  /** Длительность Ken Burns; если короче показа — дальше статичный кадр B */
  animSec?: number
  from: FocusPoint
  to: FocusPoint
  easing: EasingPreset
  /** Как появляется этот слайд; по умолчанию cut */
  transition?: ClipTransition
  /** Показывать заголовок блока на этом слайде; по умолчанию true */
  showTitle?: boolean
  /** Включить звук исходного видео (по умолчанию выключен — не пересекается с TTS). */
  playVideoAudio?: boolean
  /** Аудиофайл озвучки слайда — @deprecated перенесено в sequence.cues */
  ttsSrc?: string
}

const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'm4v'])

/** Расширение пути без query/hash. */
export function mediaSrcExt(src: string): string {
  const raw = String(src ?? '').trim()
  if (!raw) return ''
  try {
    const path = raw.includes('://') ? new URL(raw).pathname : raw.split(/[?#]/)[0] ?? ''
    const base = path.split('/').pop() ?? path
    const ext = base.includes('.') ? base.split('.').pop() ?? '' : ''
    return ext.toLowerCase()
  } catch {
    const base = (raw.split(/[?#]/)[0] ?? '').split('/').pop() ?? ''
    const ext = base.includes('.') ? base.split('.').pop() ?? '' : ''
    return ext.toLowerCase()
  }
}

export function isVideoSrc(src: string): boolean {
  return VIDEO_EXTS.has(mediaSrcExt(src))
}

export function clipMediaKind(clip: Pick<StoryClip, 'src' | 'media'>): ClipMediaKind {
  if (clip.media === 'video' || clip.media === 'image') return clip.media
  return isVideoSrc(clip.src) ? 'video' : 'image'
}

/** Титр + TTS на общей шкале времени блока (не привязан к кадру 1:1). */
export type StoryCue = {
  id: string
  /** Старт на таймлайне блока, сек */
  startSec: number
  /** Длительность показа титра / окна cue, сек */
  durationSec: number
  /** Текст титра (с {name}) */
  text?: string
  /** Показывать ли титр на слайде; по умолчанию true */
  showText?: boolean
  /** Текст для озвучки (может отличаться от титра; `{name}` — персонально при выдаче ссылки) */
  ttsText?: string
  /**
   * sha256(provider + voiceId + … + текст озвучки), с которым записан ttsSrc.
   * Смена голоса или текста даёт другой hash — файл не переиспользуется.
   */
  ttsHash?: string
  /** Озвучка */
  ttsSrc?: string
}

export type StorySequence = {
  id: string
  label: string
  title?: string
  /** @deprecated используйте clip.showTitle */
  showTitle?: boolean
  /** @deprecated не показывается — оставлен для совместимости JSON */
  subtitle?: string
  /** @deprecated используйте cues */
  lines?: string[]
  /** Титры и TTS на шкале времени */
  cues?: StoryCue[]
  clips: StoryClip[]
  /** Кнопки поверх последнего кадра; если пусто — автопереход */
  endButtons?: EndButton[]
}

export type PropertyBrand = {
  name: string
  fullName: string
  city: string
  address: string
  phoneDisplay: string
  phoneTel: string
  site: string
  whatsAppNumber: string
  telegramUsername?: string
  /** Логин или путь профиля MAX (без https://max.ru/) */
  maxUsername?: string
}

export type PropertyBranch = {
  id: BranchId
  label: string
  /** id последовательности в sequences */
  sequenceId: string
}

export const DEFAULT_MENU_TITLE = '{name}, что вам\nинтересно узнать?'
export const DEFAULT_MENU_HINT = 'Выберите тему — можно смотреть по очереди'

/** Тексты на экране меню. Выключенный блок не рисуется. */
export type MenuCopy = {
  showKicker?: boolean
  kicker?: string
  showTitle?: boolean
  title?: string
  showHint?: boolean
  hint?: string
}

export function normalizeMenuCopy(raw?: Partial<MenuCopy> | null): MenuCopy {
  const str = (value: unknown) => (typeof value === 'string' ? value : undefined)
  return {
    showKicker: raw?.showKicker !== false,
    kicker: str(raw?.kicker),
    showTitle: raw?.showTitle !== false,
    title: str(raw?.title),
    showHint: raw?.showHint !== false,
    hint: str(raw?.hint),
  }
}

/** Кнопка на меню, которая открывает ссылку, а не видео. */
export type MenuLink = {
  id: string
  label: string
  href: string
  /** Фон кнопки */
  bg: string
  /** Цвет текста кнопки */
  textColor: string
}

export const DEFAULT_WHATSAPP_HREF =
  'https://wa.me/{phone}?text=Здравствуйте! Меня зовут {name}. Смотрел(а) презентацию {brand} и хочу уточнить детали заезда.'

const MENU_LINK_ACCENT_BG = '#c4a574'
const MENU_LINK_ACCENT_TEXT = '#1a140c'
const MENU_LINK_PLAIN_BG = '#e8dfd0'
const MENU_LINK_PLAIN_TEXT = '#14201b'
const WHATSAPP_BG = '#25d366'
const TELEGRAM_BG = '#229ed9'
const MAX_BG = '#5127e7'
const CALL_BG = '#34c759'
const SMS_BG = '#007aff'
const SERVICE_TEXT = '#ffffff'

export const DEFAULT_MENU_LINKS: MenuLink[] = [
  {
    id: 'menu-link-whatsapp',
    label: 'Связаться в WhatsApp',
    href: DEFAULT_WHATSAPP_HREF,
    bg: WHATSAPP_BG,
    textColor: SERVICE_TEXT,
  },
]

export const MENU_LINK_PRESETS = [
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    label: 'Написать в WhatsApp',
    href: DEFAULT_WHATSAPP_HREF,
    bg: WHATSAPP_BG,
    textColor: SERVICE_TEXT,
  },
  {
    id: 'telegram',
    name: 'Telegram',
    label: 'Написать в Telegram',
    href: 'https://t.me/{telegram}',
    bg: TELEGRAM_BG,
    textColor: SERVICE_TEXT,
  },
  {
    id: 'max',
    name: 'MAX',
    label: 'Написать в MAX',
    href: 'https://max.ru/{max}',
    bg: MAX_BG,
    textColor: SERVICE_TEXT,
  },
  {
    id: 'tel',
    name: 'Звонок',
    label: 'Позвонить',
    href: 'tel:{tel}',
    bg: CALL_BG,
    textColor: SERVICE_TEXT,
  },
  {
    id: 'sms',
    name: 'SMS',
    label: 'Написать SMS',
    href: 'sms:{tel}?body=Здравствуйте, это {name}',
    bg: SMS_BG,
    textColor: SERVICE_TEXT,
  },
  {
    id: 'url',
    name: 'Сайт',
    label: 'Открыть сайт',
    href: 'https://',
    bg: MENU_LINK_ACCENT_BG,
    textColor: MENU_LINK_ACCENT_TEXT,
  },
] as const

export type MenuLinkPresetId = (typeof MENU_LINK_PRESETS)[number]['id']

export function menuLinkFromPreset(id: MenuLinkPresetId): MenuLink {
  const preset = MENU_LINK_PRESETS.find((p) => p.id === id) ?? MENU_LINK_PRESETS[5]
  return {
    id: newMenuLinkId(),
    label: preset.label,
    href: preset.href,
    bg: preset.bg,
    textColor: preset.textColor,
  }
}

export type MenuLinkKind = 'whatsapp' | 'telegram' | 'max' | 'tel' | 'sms' | 'site' | 'other'

/** Ссылка, разобранная на служебное начало и то, что правит пользователь. */
export type MenuLinkParts = {
  kind: MenuLinkKind
  /** Номер, логин или адрес сразу после служебного начала */
  target: string
  /** Предзаполненный текст сообщения; пусто, если тип его не поддерживает */
  text: string
}

/** Подстановка из блока «Контакты», когда поле оставлено пустым. */
export const MENU_LINK_AUTO_TOKEN: Partial<Record<MenuLinkKind, string>> = {
  whatsapp: '{phone}',
  telegram: '{telegram}',
  max: '{max}',
  tel: '{tel}',
  sms: '{tel}',
}

export const MENU_LINK_KIND_UI: Record<
  MenuLinkKind,
  { prefix: string; targetLabel: string; targetPlaceholder: string; textLabel?: string }
> = {
  whatsapp: {
    prefix: 'https://wa.me/',
    targetLabel: 'Номер',
    targetPlaceholder: '79001234567',
    textLabel: 'Текст сообщения',
  },
  telegram: {
    prefix: 'https://t.me/',
    targetLabel: 'Логин',
    targetPlaceholder: 'username',
    textLabel: 'Текст сообщения',
  },
  max: {
    prefix: 'https://max.ru/',
    targetLabel: 'Профиль',
    targetPlaceholder: 'u/… или логин',
  },
  tel: { prefix: 'tel:', targetLabel: 'Номер', targetPlaceholder: '+79001234567' },
  sms: {
    prefix: 'sms:',
    targetLabel: 'Номер',
    targetPlaceholder: '+79001234567',
    textLabel: 'Текст SMS',
  },
  site: { prefix: 'https://', targetLabel: 'Адрес сайта', targetPlaceholder: 'site.ru/page' },
  other: { prefix: '', targetLabel: 'Ссылка', targetPlaceholder: 'https://…' },
}

function decodeLinkPart(raw: string | undefined) {
  if (!raw) return ''
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

export function parseMenuLinkHref(href: string): MenuLinkParts {
  const t = href.trim()
  const wa = t.match(/^https:\/\/wa\.me\/([^?]*)(?:\?text=([\s\S]*))?$/i)
  if (wa) return { kind: 'whatsapp', target: wa[1] ?? '', text: decodeLinkPart(wa[2]) }
  const tg = t.match(/^https:\/\/t\.me\/([^?]*)(?:\?text=([\s\S]*))?$/i)
  if (tg) return { kind: 'telegram', target: tg[1] ?? '', text: decodeLinkPart(tg[2]) }
  const max = t.match(/^https:\/\/max\.ru\/([^?]*)(?:\?[\s\S]*)?$/i)
  if (max) return { kind: 'max', target: max[1] ?? '', text: '' }
  const sms = t.match(/^sms:([^?]*)(?:\?body=([\s\S]*))?$/i)
  if (sms) return { kind: 'sms', target: sms[1] ?? '', text: decodeLinkPart(sms[2]) }
  const tel = t.match(/^tel:([\s\S]*)$/i)
  if (tel) return { kind: 'tel', target: tel[1] ?? '', text: '' }
  const site = t.match(/^https:\/\/([\s\S]*)$/i)
  if (site) return { kind: 'site', target: site[1] ?? '', text: '' }
  return { kind: 'other', target: t, text: '' }
}

export function buildMenuLinkHref(parts: MenuLinkParts, encodeText = false): string {
  const target = parts.target.trim()
  const raw = parts.text.trim()
  const text = raw && encodeText ? encodeURIComponent(raw) : raw
  switch (parts.kind) {
    case 'whatsapp':
      return `https://wa.me/${target}${text ? `?text=${text}` : ''}`
    case 'telegram':
      return `https://t.me/${target}${text ? `?text=${text}` : ''}`
    case 'max':
      return `https://max.ru/${target}`
    case 'sms':
      return `sms:${target}${text ? `?body=${text}` : ''}`
    case 'tel':
      return `tel:${target}`
    case 'site':
      return `https://${target}`
    default:
      return target
  }
}

/** Оставляет только символы, допустимые для этого типа, не ломая {phone} и {tel}. */
export function sanitizeMenuLinkTarget(kind: MenuLinkKind, value: string): string {
  if (kind === 'other') return value.trim()
  if (kind === 'site') return value.trim().replace(/^https?:\/\//i, '')
  const stripped = value
    .trim()
    .replace(/^(?:https?:\/\/)?(?:www\.)?(?:wa\.me|t\.me|max\.ru)\//i, '')
    .replace(/^@+/, '')
  const allowed =
    kind === 'telegram'
      ? /[a-z0-9_+]/i
      : kind === 'max'
        ? /[a-z0-9_./-]/i
        : kind === 'whatsapp'
          ? /\d/
          : /[\d+*#]/
  return stripped.replace(/\{[a-z]+\}|[\s\S]/gi, (chunk) =>
    chunk.startsWith('{') ? chunk : allowed.test(chunk) ? chunk : '',
  )
}

export function normalizeMenuLink(raw: unknown): MenuLink | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const label = typeof o.label === 'string' ? o.label.trim() : ''
  if (!label) return null
  const rawHref = typeof o.href === 'string' ? o.href.trim() : ''
  // Старые шаблоны Telegram были пустыми или содержали буквальную заглушку username.
  const href = /^https:\/\/t\.me\/(?:username)?(?=\?|$)/i.test(rawHref)
    ? rawHref.replace(/^https:\/\/t\.me\/(?:username)?/i, 'https://t.me/{telegram}')
    : /^https:\/\/max\.ru\/(?:username)?(?=\?|$)/i.test(rawHref)
      ? rawHref.replace(/^https:\/\/max\.ru\/(?:username)?/i, 'https://max.ru/{max}')
      : rawHref
  const id = typeof o.id === 'string' && o.id.trim() ? o.id.trim() : newMenuLinkId()
  const accent = o.accent === true
  const hex = (value: unknown, fallback: string) => {
    if (typeof value !== 'string') return fallback
    const t = value.trim()
    return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(t) ? t : fallback
  }
  return {
    id,
    label,
    href,
    bg: hex(o.bg, accent ? MENU_LINK_ACCENT_BG : MENU_LINK_PLAIN_BG),
    textColor: hex(o.textColor, accent ? MENU_LINK_ACCENT_TEXT : MENU_LINK_PLAIN_TEXT),
  }
}

/** Если поле не задано — кнопка WhatsApp как раньше. Пустой массив — без ссылок. */
export function normalizeMenuLinks(raw?: MenuLink[] | null): MenuLink[] {
  if (raw == null) return DEFAULT_MENU_LINKS.map((link) => ({ ...link }))
  return raw.map(normalizeMenuLink).filter((link): link is MenuLink => Boolean(link))
}

export const STORY_FONTS = [
  { id: 'cormorant', label: 'Cormorant Garamond', css: "'Cormorant Garamond', Georgia, serif" },
  { id: 'playfair', label: 'Playfair Display', css: "'Playfair Display', Georgia, serif" },
  { id: 'libre-baskerville', label: 'Libre Baskerville', css: "'Libre Baskerville', Georgia, serif" },
  { id: 'pt-serif', label: 'PT Serif', css: "'PT Serif', Georgia, serif" },
  { id: 'source-serif', label: 'Source Serif 4', css: "'Source Serif 4', Georgia, serif" },
  { id: 'literata', label: 'Literata', css: "'Literata', Georgia, serif" },
  { id: 'manrope', label: 'Manrope', css: "'Manrope', 'Segoe UI', sans-serif" },
  { id: 'montserrat', label: 'Montserrat', css: "'Montserrat', 'Segoe UI', sans-serif" },
  { id: 'outfit', label: 'Outfit', css: "'Outfit', 'Segoe UI', sans-serif" },
  { id: 'nunito', label: 'Nunito Sans', css: "'Nunito Sans', 'Segoe UI', sans-serif" },
  { id: 'pt-sans', label: 'PT Sans', css: "'PT Sans', 'Segoe UI', sans-serif" },
] as const

export type StoryFontId = (typeof STORY_FONTS)[number]['id']

const STORY_FONT_IDS = new Set<string>(STORY_FONTS.map((f) => f.id))

export function storyFontCss(id: StoryFontId | string | undefined, fallback: StoryFontId): string {
  const safe = id && STORY_FONT_IDS.has(id) ? (id as StoryFontId) : fallback
  return STORY_FONTS.find((f) => f.id === safe)?.css ?? STORY_FONTS[0].css
}

export type ViewOrientation = 'portrait' | 'landscape'

export type PropertyTheme = {
  /** Ориентация кадра: портрет 9:16 или альбом 16:9 */
  orientation: ViewOrientation
  /** Цвет плашки под текстом на слайдах (hex) */
  captionBarColor: string
  /** Прозрачность плашки 0..1 */
  captionBarOpacity: number
  /** Цвет заголовка */
  titleColor: string
  /** Цвет текста (титров-строк) */
  textColor: string
  /** Шрифт заголовка */
  titleFont: StoryFontId
  /** Шрифт текста / титров-строк */
  textFont: StoryFontId
  /** Размер заголовка, px */
  titleFontSize: number
  /** Размер текста, px */
  textFontSize: number
  /** Начертание заголовка */
  titleBold: boolean
  titleItalic: boolean
  titleUnderline: boolean
  titleStroke: boolean
  /** Начертание титров */
  textBold: boolean
  textItalic: boolean
  textUnderline: boolean
  textStroke: boolean
  /** Громкость фоновой музыки 0..1 */
  musicVolume: number
  /** Громкость озвучки слайда 0..1 */
  ttsVolume: number
  /** Показывать кнопку «Далее» в плеере (пропуск текущего блока). */
  showNextButton: boolean
}

export const DEFAULT_THEME: PropertyTheme = {
  orientation: 'portrait',
  captionBarColor: '#0a100e',
  captionBarOpacity: 0.78,
  titleColor: '#e8dfd0',
  textColor: '#e8dfd0',
  titleFont: 'cormorant',
  textFont: 'manrope',
  titleFontSize: 28,
  textFontSize: 15,
  titleBold: true,
  titleItalic: false,
  titleUnderline: false,
  titleStroke: false,
  textBold: false,
  textItalic: false,
  textUnderline: false,
  textStroke: false,
  musicVolume: 0.22,
  ttsVolume: 1,
  showNextButton: true,
}

export type MenuTheme = {
  titleFont: StoryFontId
  titleFontSize: number
  titleColor: string
  titleBold: boolean
  titleItalic: boolean
  titleUnderline: boolean
  titleStroke: boolean
  textFont: StoryFontId
  textFontSize: number
  textColor: string
  textBold: boolean
  textItalic: boolean
  textUnderline: boolean
  textStroke: boolean
  kickerColor: string
  kickerFontSize: number
  buttonBg: string
  buttonText: string
  contactBg: string
  contactText: string
  /** Левый край блока кнопок, 0..1 */
  buttonsX: number
  /** Отступ блока снизу, 0..1 */
  buttonsY: number
  /** Ширина блока, 0..1 */
  buttonsW: number
  buttonFontSize: number
  buttonPadY: number
  buttonGap: number
  buttonRadius: number
}

export const DEFAULT_MENU_THEME: MenuTheme = {
  titleFont: 'cormorant',
  titleFontSize: 36,
  titleColor: '#e8dfd0',
  titleBold: true,
  titleItalic: false,
  titleUnderline: false,
  titleStroke: false,
  textFont: 'manrope',
  textFontSize: 14,
  textColor: '#e8dfd0',
  textBold: false,
  textItalic: false,
  textUnderline: false,
  textStroke: false,
  kickerColor: '#c4a574',
  kickerFontSize: 11,
  buttonBg: '#e8dfd0',
  buttonText: '#14201b',
  contactBg: '#c4a574',
  contactText: '#1a140c',
  buttonsX: 0.055,
  buttonsY: 0.05,
  buttonsW: 0.89,
  buttonFontSize: 16,
  buttonPadY: 14,
  buttonGap: 10,
  buttonRadius: 14,
}

export function normalizeMenuTheme(theme?: Partial<MenuTheme> | null): MenuTheme {
  return {
    titleFont: normalizeFont(theme?.titleFont, DEFAULT_MENU_THEME.titleFont),
    titleFontSize: normalizeFontSize(theme?.titleFontSize, DEFAULT_MENU_THEME.titleFontSize, 18, 56),
    titleColor: normalizeHex(theme?.titleColor, DEFAULT_MENU_THEME.titleColor),
    titleBold: normalizeBool(theme?.titleBold, DEFAULT_MENU_THEME.titleBold),
    titleItalic: normalizeBool(theme?.titleItalic, DEFAULT_MENU_THEME.titleItalic),
    titleUnderline: normalizeBool(theme?.titleUnderline, DEFAULT_MENU_THEME.titleUnderline),
    titleStroke: normalizeBool(theme?.titleStroke, DEFAULT_MENU_THEME.titleStroke),
    textFont: normalizeFont(theme?.textFont, DEFAULT_MENU_THEME.textFont),
    textFontSize: normalizeFontSize(theme?.textFontSize, DEFAULT_MENU_THEME.textFontSize, 10, 24),
    textColor: normalizeHex(theme?.textColor, DEFAULT_MENU_THEME.textColor),
    textBold: normalizeBool(theme?.textBold, DEFAULT_MENU_THEME.textBold),
    textItalic: normalizeBool(theme?.textItalic, DEFAULT_MENU_THEME.textItalic),
    textUnderline: normalizeBool(theme?.textUnderline, DEFAULT_MENU_THEME.textUnderline),
    textStroke: normalizeBool(theme?.textStroke, DEFAULT_MENU_THEME.textStroke),
    kickerColor: normalizeHex(theme?.kickerColor, DEFAULT_MENU_THEME.kickerColor),
    kickerFontSize: normalizeFontSize(
      theme?.kickerFontSize,
      DEFAULT_MENU_THEME.kickerFontSize,
      9,
      16,
    ),
    buttonBg: normalizeHex(theme?.buttonBg, DEFAULT_MENU_THEME.buttonBg),
    buttonText: normalizeHex(theme?.buttonText, DEFAULT_MENU_THEME.buttonText),
    contactBg: normalizeHex(theme?.contactBg, DEFAULT_MENU_THEME.contactBg),
    contactText: normalizeHex(theme?.contactText, DEFAULT_MENU_THEME.contactText),
    buttonsX: normalizeFrac(theme?.buttonsX, DEFAULT_MENU_THEME.buttonsX, 0, 0.7),
    buttonsY: normalizeFrac(theme?.buttonsY, DEFAULT_MENU_THEME.buttonsY, 0, 0.55),
    buttonsW: normalizeFrac(theme?.buttonsW, DEFAULT_MENU_THEME.buttonsW, 0.42, 1),
    buttonFontSize: normalizeFontSize(
      theme?.buttonFontSize,
      DEFAULT_MENU_THEME.buttonFontSize,
      12,
      24,
    ),
    buttonPadY: normalizeFontSize(theme?.buttonPadY, DEFAULT_MENU_THEME.buttonPadY, 8, 22),
    buttonGap: normalizeFontSize(theme?.buttonGap, DEFAULT_MENU_THEME.buttonGap, 4, 18),
    buttonRadius: normalizeFontSize(theme?.buttonRadius, DEFAULT_MENU_THEME.buttonRadius, 0, 32),
  }
}

export type TextStyleFlag = 'bold' | 'italic' | 'underline' | 'stroke'

export type TextStyleState = {
  bold: boolean
  italic: boolean
  underline: boolean
  stroke: boolean
}

export function textStyleFlags(style: TextStyleState): TextStyleFlag[] {
  const out: TextStyleFlag[] = []
  if (style.bold) out.push('bold')
  if (style.italic) out.push('italic')
  if (style.underline) out.push('underline')
  if (style.stroke) out.push('stroke')
  return out
}

export function textStyleFromFlags(flags: readonly string[]): TextStyleState {
  const set = new Set(flags)
  return {
    bold: set.has('bold'),
    italic: set.has('italic'),
    underline: set.has('underline'),
    stroke: set.has('stroke'),
  }
}

/** CSS-значения начертания: заголовок bold → 600 (как раньше), текст bold → 700. */
export function textStyleCssVars(
  style: TextStyleState,
  kind: 'title' | 'text',
): { weight: string; style: string; decoration: string; stroke: string } {
  return {
    weight: style.bold ? (kind === 'title' ? '600' : '700') : '400',
    style: style.italic ? 'italic' : 'normal',
    decoration: style.underline ? 'underline' : 'none',
    stroke: style.stroke
      ? kind === 'title'
        ? '1.35px #0a100e'
        : '1px #0a100e'
      : '0 transparent',
  }
}

export function menuThemeStyle(theme?: Partial<MenuTheme> | null): Record<string, string> {
  const t = normalizeMenuTheme(theme)
  const titleStyle = textStyleCssVars(
    {
      bold: t.titleBold,
      italic: t.titleItalic,
      underline: t.titleUnderline,
      stroke: t.titleStroke,
    },
    'title',
  )
  const textStyle = textStyleCssVars(
    {
      bold: t.textBold,
      italic: t.textItalic,
      underline: t.textUnderline,
      stroke: t.textStroke,
    },
    'text',
  )
  return {
    '--menu-title-font': storyFontCss(t.titleFont, DEFAULT_MENU_THEME.titleFont),
    '--menu-title-size': `${t.titleFontSize}px`,
    '--menu-title-color': t.titleColor,
    '--menu-title-weight': titleStyle.weight,
    '--menu-title-style': titleStyle.style,
    '--menu-title-decoration': titleStyle.decoration,
    '--menu-title-stroke': titleStyle.stroke,
    '--menu-text-font': storyFontCss(t.textFont, DEFAULT_MENU_THEME.textFont),
    '--menu-text-size': `${t.textFontSize}px`,
    '--menu-text-color': t.textColor,
    '--menu-text-weight': textStyle.weight,
    '--menu-text-style': textStyle.style,
    '--menu-text-decoration': textStyle.decoration,
    '--menu-text-stroke': textStyle.stroke,
    '--menu-kicker-color': t.kickerColor,
    '--menu-kicker-size': `${t.kickerFontSize}px`,
    '--menu-btn-bg': t.buttonBg,
    '--menu-btn-color': t.buttonText,
    '--menu-contact-bg': t.contactBg,
    '--menu-contact-color': t.contactText,
    '--menu-box-x': String(t.buttonsX),
    '--menu-box-y': String(t.buttonsY),
    '--menu-box-w': String(t.buttonsW),
    '--menu-btn-font': `${t.buttonFontSize}px`,
    '--menu-btn-pad-y': `${t.buttonPadY}px`,
    '--menu-btn-gap': `${t.buttonGap}px`,
    '--menu-btn-radius': `${t.buttonRadius}px`,
  }
}

export type ConstructorV2Mode = 'fixed' | 'adaptive'

export type BlockDurationClass = 'short' | 'medium' | 'long'

export type BlockMeta = {
  group: string
  subgroup?: string
  /** Если false — блок остаётся в библиотеке, но не показывается гостю. */
  enabled: boolean
  autoplayEligible: boolean
  menuOnly: boolean
  priority: number
  durationClass: BlockDurationClass
  audienceTags: string[]
  topicTags: string[]
  objectionTags: string[]
  requiresFields: string[]
  slotFields: string[]
}

/** Добор блоков в оставшийся бюджет autoplay после основной сборки. */
export type AssemblyFillRemaining = 'off' | 'soft' | 'aggressive'

export type AssemblyRules = {
  enabled: boolean
  mode: ConstructorV2Mode
  maxAutoplaySec: number
  maxBlocks: number
  alwaysStartIds: string[]
  alwaysEndIds: string[]
  /**
   * Упорядоченный cold-start: при пустых partyType/topics/objections в тело autoplay
   * попадают только эти блоки (после alwaysStart, до alwaysEnd), в этом порядке.
   */
  coldStartIds: string[]
  lowConfidenceBehavior: 'exclude' | 'menu' | 'tail'
}

export type ConstructorV2Config = {
  mode: ConstructorV2Mode
  sequenceMetaById: Record<string, BlockMeta>
  assembly: AssemblyRules
}

export type PropertyConfig = {
  id: string
  brand: PropertyBrand
  defaultGuestName: string
  greetingSubtitle: string
  /**
   * Факты об объекте для ИИ-генерации титров/заголовков (ручной ввод, без fetch с сайта).
   */
  copyFacts?: string
  sequences: Record<string, StorySequence>
  /** Порядок фаз до меню */
  flow: string[]
  /**
   * @deprecated зеркало branches главного меню — пишется в normalizeProperty
   * для совместимости со старым кодом и API-проверками
   */
  branches: PropertyBranch[]
  mediaLibrary: { folder: string; count: number }[]
  theme?: PropertyTheme
  /** Экраны меню (главное, после блока и т.д.) */
  menus?: Record<string, MenuScreenConfig>
  /** Меню после автопоказа и цель для target.kind === 'menu' без menuId */
  defaultMenuId?: string
  /** @deprecated см. menus[defaultMenuId].menuTtsSrc */
  menuTtsSrc?: string
  /** @deprecated см. menus[defaultMenuId].menuTtsFirstOnly */
  menuTtsFirstOnly?: boolean
  /** @deprecated см. menus[defaultMenuId].menuCopy */
  menuCopy?: MenuCopy
  /** @deprecated см. menus[defaultMenuId].menuTheme */
  menuTheme?: MenuTheme
  /** @deprecated см. menus[defaultMenuId].menuLinks */
  menuLinks?: MenuLink[]
  /** Фон плеера. По умолчанию /media/projects/{code}/music/ambient.mp3 */
  musicSrc?: string
  /** Последняя опубликованная короткая ссылка (без имени объекта) */
  shareId?: string
  /** Картинка для письма `{url}/preview.jpg`. По умолчанию выключена. */
  emailPreview?: EmailPreviewConfig
  /** Constructor V2: approved block metadata + assembly rules. */
  constructorV2?: ConstructorV2Config
}

export type EmailPreviewConfig = {
  /** Собирать JPEG. По умолчанию нет — почта блокирует удалённые картинки */
  enabled?: boolean
  /** Своё фото; пусто — первый кадр приветствия / автопоказа */
  src?: string
  /** Иконка play поверх кадра. По умолчанию да */
  showPlay?: boolean
  /** Титр с именем гостя. По умолчанию да */
  showTitle?: boolean
  /** Шаблон титра, плейсхолдер `{name}` */
  title?: string
}

export const DEFAULT_MENU_ID = 'main'

/** Один экран меню: тексты, ссылки, ветки-видео. */
export type MenuScreenConfig = {
  id: string
  label: string
  branches: PropertyBranch[]
  menuCopy?: MenuCopy
  menuTheme?: MenuTheme
  menuLinks?: MenuLink[]
  /** Фон меню (фото из медиатеки проекта). */
  menuBgSrc?: string
  /** Текст для синтеза озвучки меню (как ttsText у титра). */
  menuTtsText?: string
  menuTtsSrc?: string
  menuTtsHash?: string
  menuTtsFirstOnly?: boolean
}

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

function normalizeHex(value: unknown, fallback: string): string {
  if (typeof value === 'string' && HEX_RE.test(value.trim())) return value.trim()
  return fallback
}

function normalizeBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function normalizeFont(value: unknown, fallback: StoryFontId): StoryFontId {
  if (typeof value === 'string' && STORY_FONT_IDS.has(value)) return value as StoryFontId
  return fallback
}

function normalizeFontSize(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

function normalizeUnit(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(1, Math.max(0, value))
}

function normalizeFrac(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 24)
}

export function defaultBlockMeta(): BlockMeta {
  return {
    group: '',
    subgroup: undefined,
    enabled: true,
    autoplayEligible: true,
    menuOnly: false,
    priority: 3,
    durationClass: 'medium',
    audienceTags: [],
    topicTags: [],
    objectionTags: [],
    requiresFields: [],
    slotFields: [],
  }
}

export function normalizeBlockMeta(value: unknown): BlockMeta {
  const meta = value && typeof value === 'object' ? (value as Partial<BlockMeta>) : {}
  const base = defaultBlockMeta()
  const group = typeof meta.group === 'string' ? meta.group.trim().slice(0, 64) : ''
  const subgroup =
    typeof meta.subgroup === 'string' && meta.subgroup.trim()
      ? meta.subgroup.trim().slice(0, 64)
      : undefined
  return {
    group,
    ...(subgroup ? { subgroup } : {}),
    enabled: meta.enabled !== false,
    autoplayEligible: meta.autoplayEligible !== false,
    menuOnly: meta.menuOnly === true,
    priority: normalizeFontSize(meta.priority, base.priority, 1, 99),
    durationClass:
      meta.durationClass === 'short' || meta.durationClass === 'medium' || meta.durationClass === 'long'
        ? meta.durationClass
        : base.durationClass,
    audienceTags: normalizeStringList(meta.audienceTags),
    topicTags: normalizeStringList(meta.topicTags),
    objectionTags: normalizeStringList(meta.objectionTags),
    requiresFields: normalizeStringList(meta.requiresFields).map((item) =>
      item.trim().toLowerCase() === 'guestname' ? 'name' : item.trim(),
    ),
    slotFields: normalizeStringList(meta.slotFields),
  }
}

export function defaultAssemblyRules(): AssemblyRules {
  return {
    enabled: false,
    mode: 'fixed',
    maxAutoplaySec: 90,
    maxBlocks: 5,
    alwaysStartIds: [],
    alwaysEndIds: [],
    coldStartIds: [],
    lowConfidenceBehavior: 'menu',
  }
}

export function normalizeAssemblyRules(value: unknown, sequences: Record<string, StorySequence>): AssemblyRules {
  const rules = value && typeof value === 'object' ? (value as Partial<AssemblyRules>) : {}
  const fallback = defaultAssemblyRules()
  const filterSeqIds = (items: unknown) => normalizeStringList(items).filter((id) => Boolean(sequences[id]))
  return {
    enabled: rules.enabled === true,
    mode: rules.mode === 'adaptive' ? 'adaptive' : fallback.mode,
    maxAutoplaySec: normalizeFontSize(rules.maxAutoplaySec, fallback.maxAutoplaySec, 15, 300),
    maxBlocks: normalizeFontSize(rules.maxBlocks, fallback.maxBlocks, 1, 20),
    alwaysStartIds: filterSeqIds(rules.alwaysStartIds),
    alwaysEndIds: filterSeqIds(rules.alwaysEndIds),
    coldStartIds: filterSeqIds(rules.coldStartIds),
    lowConfidenceBehavior:
      rules.lowConfidenceBehavior === 'exclude' ||
      rules.lowConfidenceBehavior === 'menu' ||
      rules.lowConfidenceBehavior === 'tail'
        ? rules.lowConfidenceBehavior
        : fallback.lowConfidenceBehavior,
  }
}

export function normalizeConstructorV2(
  value: unknown,
  sequences: Record<string, StorySequence>,
): ConstructorV2Config {
  const raw = value && typeof value === 'object' ? (value as Partial<ConstructorV2Config>) : {}
  const metaSource =
    raw.sequenceMetaById && typeof raw.sequenceMetaById === 'object' ? raw.sequenceMetaById : {}
  const sequenceMetaById: Record<string, BlockMeta> = {}
  for (const id of Object.keys(sequences)) {
    sequenceMetaById[id] = normalizeBlockMeta((metaSource as Record<string, unknown>)[id])
  }
  return {
    mode: raw.mode === 'adaptive' ? 'adaptive' : 'fixed',
    sequenceMetaById,
    assembly: normalizeAssemblyRules(raw.assembly, sequences),
  }
}

export function isBlockEnabled(config: PropertyConfig, sequenceId: string): boolean {
  return (config.constructorV2?.sequenceMetaById?.[sequenceId] ?? defaultBlockMeta()).enabled !== false
}

/** Блок не идёт в автопоказ — только через меню (UI: «Запускается только через меню»). */
export function isMenuOnlyBlock(meta: BlockMeta): boolean {
  return meta.menuOnly === true || meta.autoplayEligible === false
}

export function menuOnlyBlockPatch(onlyMenu: boolean): Pick<BlockMeta, 'menuOnly' | 'autoplayEligible'> {
  return onlyMenu
    ? { menuOnly: true, autoplayEligible: false }
    : { menuOnly: false, autoplayEligible: true }
}

/** Убирает выключенные блоки из flow и меню — для плеера. Сами sequences остаются. */
export function withoutDisabledBlocks(config: PropertyConfig): PropertyConfig {
  const enabledId = (id: string) => Boolean(config.sequences[id]) && isBlockEnabled(config, id)
  const flow = (config.flow ?? []).filter(enabledId)
  if (!config.menus || Object.keys(config.menus).length === 0) {
    return { ...config, flow }
  }
  const menus = Object.fromEntries(
    Object.entries(config.menus).map(([id, menu]) => [
      id,
      { ...menu, branches: menu.branches.filter((branch) => enabledId(branch.sequenceId)) },
    ]),
  )
  return withMenus({ ...config, flow }, menus, config.defaultMenuId)
}

export function normalizeTheme(theme?: Partial<PropertyTheme> | null): PropertyTheme {
  const opacityRaw = theme?.captionBarOpacity
  const opacity =
    typeof opacityRaw === 'number' && Number.isFinite(opacityRaw)
      ? Math.min(1, Math.max(0, opacityRaw))
      : DEFAULT_THEME.captionBarOpacity
  const orientation: ViewOrientation =
    theme?.orientation === 'landscape' ? 'landscape' : 'portrait'
  return {
    orientation,
    captionBarColor: normalizeHex(theme?.captionBarColor, DEFAULT_THEME.captionBarColor),
    captionBarOpacity: opacity,
    titleColor: normalizeHex(theme?.titleColor, DEFAULT_THEME.titleColor),
    textColor: normalizeHex(theme?.textColor, DEFAULT_THEME.textColor),
    titleFont: normalizeFont(theme?.titleFont, DEFAULT_THEME.titleFont),
    textFont: normalizeFont(theme?.textFont, DEFAULT_THEME.textFont),
    titleFontSize: normalizeFontSize(theme?.titleFontSize, DEFAULT_THEME.titleFontSize, 14, 56),
    textFontSize: normalizeFontSize(theme?.textFontSize, DEFAULT_THEME.textFontSize, 10, 32),
    titleBold: normalizeBool(theme?.titleBold, DEFAULT_THEME.titleBold),
    titleItalic: normalizeBool(theme?.titleItalic, DEFAULT_THEME.titleItalic),
    titleUnderline: normalizeBool(theme?.titleUnderline, DEFAULT_THEME.titleUnderline),
    titleStroke: normalizeBool(theme?.titleStroke, DEFAULT_THEME.titleStroke),
    textBold: normalizeBool(theme?.textBold, DEFAULT_THEME.textBold),
    textItalic: normalizeBool(theme?.textItalic, DEFAULT_THEME.textItalic),
    textUnderline: normalizeBool(theme?.textUnderline, DEFAULT_THEME.textUnderline),
    textStroke: normalizeBool(theme?.textStroke, DEFAULT_THEME.textStroke),
    musicVolume: normalizeUnit(theme?.musicVolume, DEFAULT_THEME.musicVolume),
    ttsVolume: normalizeUnit(theme?.ttsVolume, DEFAULT_THEME.ttsVolume),
    showNextButton: normalizeBool(theme?.showNextButton, DEFAULT_THEME.showNextButton),
  }
}

export function captionBarCss(theme?: Partial<PropertyTheme> | null): string {
  const t = normalizeTheme(theme)
  const hex = t.captionBarColor.replace('#', '')
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((c) => c + c)
          .join('')
      : hex
  const r = Number.parseInt(full.slice(0, 2), 16)
  const g = Number.parseInt(full.slice(2, 4), 16)
  const b = Number.parseInt(full.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${t.captionBarOpacity})`
}

/** Стили плашки, цветов и шрифтов; при opacity 0 — без blur */
export function captionBarStyle(
  theme?: Partial<PropertyTheme> | null,
): Record<string, string> {
  const t = normalizeTheme(theme)
  const titleStyle = textStyleCssVars(
    {
      bold: t.titleBold,
      italic: t.titleItalic,
      underline: t.titleUnderline,
      stroke: t.titleStroke,
    },
    'title',
  )
  const textStyle = textStyleCssVars(
    {
      bold: t.textBold,
      italic: t.textItalic,
      underline: t.textUnderline,
      stroke: t.textStroke,
    },
    'text',
  )
  const typography = {
    '--story-title-color': t.titleColor,
    '--story-text-color': t.textColor,
    '--story-title-font': storyFontCss(t.titleFont, DEFAULT_THEME.titleFont),
    '--story-text-font': storyFontCss(t.textFont, DEFAULT_THEME.textFont),
    '--story-title-size': `${t.titleFontSize}px`,
    '--story-text-size': `${t.textFontSize}px`,
    '--story-title-weight': titleStyle.weight,
    '--story-title-style': titleStyle.style,
    '--story-title-decoration': titleStyle.decoration,
    '--story-title-stroke': titleStyle.stroke,
    '--story-text-weight': textStyle.weight,
    '--story-text-style': textStyle.style,
    '--story-text-decoration': textStyle.decoration,
    '--story-text-stroke': textStyle.stroke,
  }
  if (t.captionBarOpacity <= 0) {
    return {
      ...typography,
      background: 'transparent',
      backdropFilter: 'none',
      WebkitBackdropFilter: 'none',
      boxShadow: 'none',
    }
  }
  return {
    ...typography,
    background: captionBarCss(t),
  }
}

export function sequenceDuration(seq: StorySequence) {
  return seq.clips.reduce((sum, c) => sum + clipHoldSec(c), 0)
}

export function clipHoldSec(clip: Pick<StoryClip, 'durationSec'>) {
  return Math.max(0.8, clip.durationSec)
}

/** Длительность анимации кадра ≤ времени показа. */
export function clipAnimSec(clip: Pick<StoryClip, 'durationSec' | 'animSec'>) {
  // Анимация всегда на всю длительность показа слайда
  return clipHoldSec(clip)
}

export function newClipId(prefix = 'clip') {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`
}

export function newSequenceId(prefix = 'seq') {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`
}

export function newEndButtonId() {
  return `btn-${Math.random().toString(36).slice(2, 9)}`
}

export function newMenuId(prefix = 'menu') {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`
}

export function newMenuLinkId() {
  return `link-${Math.random().toString(36).slice(2, 9)}`
}

export function newCueId() {
  return `cue-${Math.random().toString(36).slice(2, 9)}`
}

export function normalizeCue(raw: Partial<StoryCue> | StoryCue): StoryCue {
  const text = typeof raw.text === 'string' ? raw.text : undefined
  const ttsText = typeof raw.ttsText === 'string' ? raw.ttsText : undefined
  const ttsHash =
    typeof raw.ttsHash === 'string' && raw.ttsHash.trim() ? raw.ttsHash.trim() : undefined
  const ttsSrc =
    typeof raw.ttsSrc === 'string' && raw.ttsSrc.trim() ? raw.ttsSrc.trim() : undefined
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : newCueId(),
    startSec: Math.max(0, Number(raw.startSec) || 0),
    durationSec: Math.max(0.3, Number(raw.durationSec) || 2),
    ...(text !== undefined ? { text } : {}),
    ...(typeof raw.showText === 'boolean' ? { showText: raw.showText } : {}),
    ...(ttsText !== undefined ? { ttsText } : {}),
    ...(ttsHash ? { ttsHash } : {}),
    ...(ttsSrc ? { ttsSrc } : {}),
  }
}

/** Старые lines[] + clip.ttsSrc → cues на шкале времени. */
export function migrateSequenceCues(seq: StorySequence): StoryCue[] {
  if (Array.isArray(seq.cues) && seq.cues.length > 0) {
    return seq.cues.map((c) => normalizeCue(c))
  }
  const clips = seq.clips ?? []
  const lines = seq.lines ?? []
  const n = Math.max(clips.length, lines.length)
  const cues: StoryCue[] = []
  let t = 0
  for (let i = 0; i < n; i++) {
    const clip = clips[i]
    const text = lines[i]?.trim() ? lines[i] : undefined
    const ttsSrc =
      typeof clip?.ttsSrc === 'string' && clip.ttsSrc.trim() ? clip.ttsSrc.trim() : undefined
    const dur = clip ? clipHoldSec(clip) : 2.5
    if (text || ttsSrc) {
      cues.push(
        normalizeCue({
          startSec: Number(t.toFixed(3)),
          durationSec: dur,
          text,
          ttsSrc,
        }),
      )
    }
    t += dur
  }
  return cues
}

/** Активный cue в момент timeSec (при пересечении — последний начавшийся). */
export function activeCueAt(cues: StoryCue[] | undefined, timeSec: number): StoryCue | undefined {
  if (!cues?.length) return undefined
  let found: StoryCue | undefined
  let bestStart = -1
  for (const c of cues) {
    if (timeSec >= c.startSec && timeSec < c.startSec + c.durationSec && c.startSec >= bestStart) {
      found = c
      bestStart = c.startSec
    }
  }
  return found
}

export function clipStartTimes(clips: StoryClip[]): number[] {
  const starts: number[] = []
  let t = 0
  for (const c of clips) {
    starts.push(t)
    t += clipHoldSec(c)
  }
  return starts
}

function normalizeEndButton(
  raw: EndButton,
  sequences: Record<string, StorySequence>,
  menus: Record<string, MenuScreenConfig>,
): EndButton | null {
  if (!raw || typeof raw !== 'object') return null
  const label = typeof raw.label === 'string' ? raw.label.trim() : ''
  if (!label) return null
  const id = typeof raw.id === 'string' && raw.id ? raw.id : newEndButtonId()
  const t = raw.target
  if (!t || typeof t !== 'object' || !('kind' in t)) return null
  if (t.kind === 'next' || t.kind === 'contact') {
    return { id, label, target: { kind: t.kind } }
  }
  if (t.kind === 'menu') {
    const menuId = typeof t.menuId === 'string' && menus[t.menuId] ? t.menuId : undefined
    return { id, label, target: menuId ? { kind: 'menu', menuId } : { kind: 'menu' } }
  }
  if (t.kind === 'sequence') {
    const sequenceId = typeof t.sequenceId === 'string' ? t.sequenceId : ''
    if (!sequenceId || !sequences[sequenceId]) return null
    return { id, label, target: { kind: 'sequence', sequenceId } }
  }
  return null
}

export function normalizeEndButtons(
  buttons: EndButton[] | undefined,
  sequences: Record<string, StorySequence>,
  menus: Record<string, MenuScreenConfig> = {},
): EndButton[] | undefined {
  if (!buttons?.length) return undefined
  const next = buttons
    .map((b) => normalizeEndButton(b, sequences, menus))
    .filter((b): b is EndButton => Boolean(b))
  return next.length ? next : undefined
}

/** Нет кнопок или только «в меню» / связь → плеер сразу открывает меню, без оверлея. */
export function endButtonsGoStraightToMenu(buttons: EndButton[] | undefined) {
  if (!buttons?.length) return true
  return buttons.every((b) => b.target.kind === 'menu' || b.target.kind === 'contact')
}

/** Какое меню открыть после блока (из endButtons kind=menu). */
export function resolveReturnMenuId(
  endButtons: EndButton[] | undefined,
  fallback: string,
): string {
  const menuBtn = endButtons?.find((b) => b.target.kind === 'menu')
  if (menuBtn?.target.kind === 'menu' && menuBtn.target.menuId) return menuBtn.target.menuId
  return fallback
}

/**
 * Задаёт «после ролика → это меню».
 * Стирает старые endButtons (в т.ч. оверлей с темами) — меню теперь единственный выход.
 */
export function withReturnMenu(seq: StorySequence, menuId: string): StorySequence {
  const existing = seq.endButtons?.find((b) => b.target.kind === 'menu')
  return {
    ...seq,
    endButtons: [
      {
        id: existing?.id ?? newEndButtonId(),
        label: existing?.label?.trim() || 'В меню',
        target: { kind: 'menu', menuId },
      },
    ],
  }
}

export function createMenuScreen(
  partial?: Partial<MenuScreenConfig> & { id?: string; label?: string },
): MenuScreenConfig {
  const id = typeof partial?.id === 'string' && partial.id.trim() ? partial.id.trim() : newMenuId()
  const label =
    typeof partial?.label === 'string' && partial.label.trim() ? partial.label.trim() : 'Меню'
  const menuTtsSrc =
    typeof partial?.menuTtsSrc === 'string' && partial.menuTtsSrc.trim()
      ? partial.menuTtsSrc.trim()
      : undefined
  const menuTtsText = typeof partial?.menuTtsText === 'string' ? partial.menuTtsText : undefined
  const menuTtsHash =
    typeof partial?.menuTtsHash === 'string' && partial.menuTtsHash.trim()
      ? partial.menuTtsHash.trim()
      : undefined
  const menuBgSrc =
    typeof partial?.menuBgSrc === 'string' && partial.menuBgSrc.trim()
      ? partial.menuBgSrc.trim()
      : undefined
  return {
    id,
    label,
    branches: Array.isArray(partial?.branches) ? [...partial.branches] : [],
    menuCopy: normalizeMenuCopy(partial?.menuCopy),
    menuTheme: normalizeMenuTheme(partial?.menuTheme),
    menuLinks: normalizeMenuLinks(partial?.menuLinks),
    ...(menuBgSrc ? { menuBgSrc } : {}),
    menuTtsText,
    menuTtsSrc,
    menuTtsHash,
    menuTtsFirstOnly: partial?.menuTtsFirstOnly !== false,
  }
}

function normalizeMenuScreen(
  raw: unknown,
  sequences: Record<string, StorySequence>,
  fallbackId: string,
  legacy?: {
    branches?: PropertyBranch[]
    menuCopy?: MenuCopy
    menuTheme?: MenuTheme
    menuLinks?: MenuLink[]
    menuTtsText?: string
    menuTtsSrc?: string
    menuTtsHash?: string
    menuTtsFirstOnly?: boolean
  },
): MenuScreenConfig | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = typeof o.id === 'string' && o.id.trim() ? o.id.trim() : fallbackId
  const label = typeof o.label === 'string' && o.label.trim() ? o.label.trim() : 'Меню'
  const branchSource = Array.isArray(o.branches)
    ? o.branches
    : Array.isArray(legacy?.branches)
      ? legacy.branches
      : []
  const branches = branchSource
    .filter(
      (b): b is PropertyBranch =>
        Boolean(b) &&
        typeof b === 'object' &&
        typeof (b as PropertyBranch).id === 'string' &&
        typeof (b as PropertyBranch).label === 'string' &&
        typeof (b as PropertyBranch).sequenceId === 'string' &&
        Boolean(sequences[(b as PropertyBranch).sequenceId]),
    )
    .map((b) => ({
      id: b.id,
      label: b.label,
      sequenceId: b.sequenceId,
    }))
  const rawLinks = o.menuLinks !== undefined ? o.menuLinks : legacy?.menuLinks
  const rawTheme = o.menuTheme !== undefined ? o.menuTheme : legacy?.menuTheme
  const rawCopy = o.menuCopy !== undefined ? o.menuCopy : legacy?.menuCopy
  const rawTtsText =
    typeof o.menuTtsText === 'string'
      ? o.menuTtsText
      : typeof legacy?.menuTtsText === 'string'
        ? legacy.menuTtsText
        : undefined
  const rawTts =
    typeof o.menuTtsSrc === 'string'
      ? o.menuTtsSrc
      : typeof legacy?.menuTtsSrc === 'string'
        ? legacy.menuTtsSrc
        : undefined
  const rawTtsHash =
    typeof o.menuTtsHash === 'string'
      ? o.menuTtsHash
      : typeof legacy?.menuTtsHash === 'string'
        ? legacy.menuTtsHash
        : undefined
  const rawFirstOnly =
    o.menuTtsFirstOnly !== undefined ? o.menuTtsFirstOnly !== false : legacy?.menuTtsFirstOnly !== false
  const rawBg =
    typeof o.menuBgSrc === 'string' && o.menuBgSrc.trim() ? o.menuBgSrc.trim() : undefined
  return createMenuScreen({
    id,
    label,
    branches,
    menuCopy: rawCopy as MenuCopy | undefined,
    menuTheme: rawTheme as MenuTheme | undefined,
    menuLinks: rawLinks as MenuLink[] | undefined,
    menuBgSrc: rawBg,
    menuTtsText: rawTtsText,
    menuTtsSrc: rawTts,
    menuTtsHash: rawTtsHash,
    menuTtsFirstOnly: rawFirstOnly,
  })
}

/** Собирает menus из нового формата или из плоских полей старого JSON. */
export function normalizeMenus(
  config: PropertyConfig,
  sequences: Record<string, StorySequence>,
): { menus: Record<string, MenuScreenConfig>; defaultMenuId: string } {
  const menus: Record<string, MenuScreenConfig> = {}
  const legacy = {
    branches: config.branches,
    menuCopy: config.menuCopy,
    menuTheme: config.menuTheme,
    menuLinks: config.menuLinks,
    menuTtsSrc: config.menuTtsSrc,
    menuTtsFirstOnly: config.menuTtsFirstOnly,
  }
  const rawMenus = config.menus
  if (rawMenus && typeof rawMenus === 'object') {
    for (const [key, raw] of Object.entries(rawMenus)) {
      const menu = normalizeMenuScreen(raw, sequences, key, legacy)
      if (menu) menus[menu.id] = menu
    }
  }

  if (!Object.keys(menus).length) {
    const migrated = createMenuScreen({
      id: DEFAULT_MENU_ID,
      label: 'Главное меню',
      branches: [...(config.branches ?? [])].filter((b) => sequences[b.sequenceId]),
      menuCopy: config.menuCopy,
      menuTheme: config.menuTheme,
      menuLinks: config.menuLinks,
      menuTtsSrc: config.menuTtsSrc,
      menuTtsFirstOnly: config.menuTtsFirstOnly,
    })
    menus[migrated.id] = migrated
  }

  const preferred =
    typeof config.defaultMenuId === 'string' && menus[config.defaultMenuId]
      ? config.defaultMenuId
      : menus[DEFAULT_MENU_ID]
        ? DEFAULT_MENU_ID
        : Object.keys(menus)[0]

  return { menus, defaultMenuId: preferred }
}

export function getDefaultMenuId(property: Pick<PropertyConfig, 'menus' | 'defaultMenuId'>): string {
  if (property.defaultMenuId && property.menus?.[property.defaultMenuId]) {
    return property.defaultMenuId
  }
  if (property.menus?.[DEFAULT_MENU_ID]) return DEFAULT_MENU_ID
  return Object.keys(property.menus ?? {})[0] ?? DEFAULT_MENU_ID
}

export function listMenus(property: Pick<PropertyConfig, 'menus' | 'defaultMenuId'>): MenuScreenConfig[] {
  const menus = property.menus ?? {}
  const defaultId = getDefaultMenuId(property)
  return Object.values(menus).sort((a, b) => {
    if (a.id === defaultId) return -1
    if (b.id === defaultId) return 1
    return a.label.localeCompare(b.label, 'ru')
  })
}

export function resolveMenu(
  property: PropertyConfig,
  menuId?: string | null,
): MenuScreenConfig {
  const defaultId = getDefaultMenuId(property)
  const id = menuId && property.menus?.[menuId] ? menuId : defaultId
  const menu = property.menus?.[id]
  if (menu) return menu
  return createMenuScreen({
    id: DEFAULT_MENU_ID,
    label: 'Главное меню',
    branches: property.branches ?? [],
    menuCopy: property.menuCopy,
    menuTheme: property.menuTheme,
    menuLinks: property.menuLinks,
    menuTtsSrc: property.menuTtsSrc,
    menuTtsFirstOnly: property.menuTtsFirstOnly,
  })
}

/** Обновляет menus и зеркала плоских полей главного меню. */
export function withMenus(
  config: PropertyConfig,
  menus: Record<string, MenuScreenConfig>,
  defaultMenuId?: string,
): PropertyConfig {
  const did =
    defaultMenuId && menus[defaultMenuId]
      ? defaultMenuId
      : getDefaultMenuId({ ...config, menus, defaultMenuId })
  const main = menus[did] ?? Object.values(menus)[0]
  return {
    ...config,
    menus,
    defaultMenuId: did,
    branches: main?.branches ?? [],
    menuCopy: main?.menuCopy,
    menuTheme: main?.menuTheme,
    menuLinks: main?.menuLinks,
    menuTtsSrc: main?.menuTtsSrc,
    menuTtsFirstOnly: main?.menuTtsFirstOnly,
  }
}

export function updateMenu(
  config: PropertyConfig,
  menuId: string,
  patch: Partial<MenuScreenConfig>,
): PropertyConfig {
  const current = config.menus?.[menuId] ?? resolveMenu(config, menuId)
  const next = createMenuScreen({ ...current, ...patch, id: menuId })
  return withMenus(config, { ...config.menus, [menuId]: next }, config.defaultMenuId)
}

export function clamp01(n: number, pad = 0.04) {
  return Math.min(1 - pad, Math.max(pad, n))
}

export function pathFromPreset(motion: Exclude<MotionPreset, 'custom'>): MotionPath {
  return {
    from: { ...MOTION_PATHS[motion].from },
    to: { ...MOTION_PATHS[motion].to },
  }
}

export function normalizeClip(clip: StoryClip): StoryClip {
  const media = clipMediaKind(clip)
  const fallback =
    clip.motion !== 'custom' && clip.motion in MOTION_PATHS
      ? MOTION_PATHS[clip.motion as Exclude<MotionPreset, 'custom'>]
      : MOTION_PATHS.none
  const easing =
    clip.easing && (EASING_PRESETS as string[]).includes(clip.easing)
      ? clip.easing
      : DEFAULT_EASING
  const transition =
    clip.transition && (CLIP_TRANSITIONS as string[]).includes(clip.transition)
      ? clip.transition
      : DEFAULT_TRANSITION
  let motion =
    clip.motion && (MOTION_PRESETS as string[]).includes(clip.motion)
      ? clip.motion
      : DEFAULT_MOTION
  // Видео: Ken Burns / кроп-путь пока не трогаем
  if (media === 'video') motion = 'none'
  const sourceDurationSec =
    media === 'video' && Number.isFinite(clip.sourceDurationSec) && Number(clip.sourceDurationSec) > 0
      ? Number(clip.sourceDurationSec)
      : undefined
  const maxStart = sourceDurationSec ? Math.max(0, sourceDurationSec - 0.8) : Number.MAX_SAFE_INTEGER
  const trimStartSec =
    media === 'video'
      ? Math.min(maxStart, Math.max(0, Number(clip.trimStartSec) || 0))
      : undefined
  const maxDuration =
    sourceDurationSec && trimStartSec != null
      ? Math.max(0.8, sourceDurationSec - trimStartSec)
      : Number.MAX_SAFE_INTEGER
  const durationSec = Math.min(maxDuration, Math.max(0.8, clip.durationSec || 2.5))
  const animSec = durationSec
  const ttsSrc =
    typeof clip.ttsSrc === 'string' && clip.ttsSrc.trim() ? clip.ttsSrc.trim() : undefined
  return {
    ...clip,
    media,
    sourceDurationSec,
    trimStartSec,
    motion,
    durationSec,
    animSec,
    easing,
    transition,
    from: clip.from ? { ...fallback.from, ...clip.from } : { ...fallback.from },
    to: clip.to ? { ...fallback.to, ...clip.to } : { ...fallback.to },
    ...(typeof clip.showTitle === 'boolean' ? { showTitle: clip.showTitle } : {}),
    ...(media === 'video' && clip.playVideoAudio ? { playVideoAudio: true } : {}),
    ...(ttsSrc ? { ttsSrc } : {}),
  }
}

export function clipShowsTitle(clip: Pick<StoryClip, 'showTitle'> | undefined): boolean {
  return clip?.showTitle !== false
}

const PREVIEW_IMAGE_RE = /\.(jpe?g|png|webp)(\?|$)/i

export function normalizeEmailPreview(value: unknown): EmailPreviewConfig {
  if (!value || typeof value !== 'object') {
    return { enabled: false, showPlay: true, showTitle: true }
  }
  const raw = value as Record<string, unknown>
  const src = typeof raw.src === 'string' && raw.src.trim() ? raw.src.trim() : undefined
  const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : undefined
  return {
    enabled: raw.enabled === true,
    ...(src ? { src } : {}),
    showPlay: raw.showPlay !== false,
    showTitle: raw.showTitle !== false,
    ...(title ? { title } : {}),
  }
}

/** Кадр по умолчанию для превью письма, если своё фото не задано. */
export function firstAutoplayImageSrc(
  config: Pick<PropertyConfig, 'flow' | 'sequences'>,
): string | undefined {
  const greeting = config.sequences?.greeting
  const flowIds = Array.isArray(config.flow) ? config.flow : []
  const seen = new Set<string>()
  const seqs: StorySequence[] = []
  for (const seq of [greeting, ...flowIds.map((id) => config.sequences?.[id]), ...Object.values(config.sequences ?? {})]) {
    if (!seq?.id || seen.has(seq.id)) continue
    seen.add(seq.id)
    seqs.push(seq)
  }
  for (const seq of seqs) {
    for (const clip of seq.clips ?? []) {
      if (clip.src && PREVIEW_IMAGE_RE.test(clip.src)) return clip.src
    }
  }
  return undefined
}

export function normalizeProperty(config: PropertyConfig): PropertyConfig {
  const sequences: PropertyConfig['sequences'] = {}
  for (const [id, seq] of Object.entries(config.sequences ?? {})) {
    const seqShowTitle = seq.showTitle
    const clips = (seq.clips ?? []).map((c) => {
      const normalized = normalizeClip(c as StoryClip)
      if (typeof normalized.showTitle !== 'boolean' && seqShowTitle === false) {
        return { ...normalized, showTitle: false }
      }
      return normalized
    })
    const withClips = { ...seq, clips }
    const cues = migrateSequenceCues(withClips)
    // После миграции в cues убираем tts с клипов — видео-дорожка без озвучки
    const cleanedClips = clips.map((c) => {
      if (!c.ttsSrc) return c
      const { ttsSrc: _tts, ...rest } = c
      void _tts
      return rest
    })
    sequences[id] = {
      ...withClips,
      clips: cleanedClips,
      cues,
    }
  }
  const { menus, defaultMenuId } = normalizeMenus(config, sequences)
  for (const [id, seq] of Object.entries(sequences)) {
    sequences[id] = {
      ...seq,
      endButtons: normalizeEndButtons(seq.endButtons, sequences, menus),
    }
  }
  const main = menus[defaultMenuId]
  const copyFactsRaw = typeof config.copyFacts === 'string' ? config.copyFacts : ''
  const copyFacts = copyFactsRaw.trim() ? copyFactsRaw : undefined
  return {
    ...config,
    theme: normalizeTheme(config.theme),
    sequences,
    flow: [...(config.flow ?? [])].filter((id) => sequences[id]),
    menus,
    defaultMenuId,
    branches: main?.branches ?? [],
    menuTtsSrc: main?.menuTtsSrc,
    menuTtsFirstOnly: main?.menuTtsFirstOnly !== false,
    menuCopy: main?.menuCopy ?? normalizeMenuCopy(undefined),
    menuTheme: main?.menuTheme ?? normalizeMenuTheme(undefined),
    menuLinks: main?.menuLinks ?? normalizeMenuLinks(undefined),
    musicSrc:
      typeof config.musicSrc === 'string' && config.musicSrc.trim()
        ? config.musicSrc.trim()
        : undefined,
    ...(copyFacts ? { copyFacts } : { copyFacts: undefined }),
    emailPreview: normalizeEmailPreview(config.emailPreview),
    shareId:
      typeof config.shareId === 'string' && /^[a-z0-9]{3,16}$/i.test(config.shareId)
        ? config.shareId.toLowerCase()
        : undefined,
    constructorV2: normalizeConstructorV2(config.constructorV2, sequences),
  }
}
