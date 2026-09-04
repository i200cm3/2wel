export type PlanId = 'start' | 'pro'

export type PlanConstructor = 'v1' | 'v2'

export type PlanTier = {
  id: PlanId
  name: string
  /** Базовая цена «от …» ₽ / мес */
  price: number
  /** Внутренний тип продукта — на лендинге не показываем. */
  constructor: PlanConstructor
  /** Короткая подпись для клиента. */
  tagline: string
  setup: string
  blurb: string
  features: string[]
}

/**
 * Два тарифа по глубине персонализации.
 * Ссылки без лимита — прайс за продукт, не за объём.
 */
export const PLAN_TIERS: PlanTier[] = [
  {
    id: 'start',
    name: 'Старт',
    price: 11900,
    constructor: 'v1',
    tagline: 'Готовые сценарии',
    setup: 'от 29 000 ₽',
    blurb:
      'Персональная страница гостю по готовому сценарию: с именем в озвучке, кабинетом и связью с CRM.',
    features: [
      'Персональная страница с именем гостя',
      'Готовые сценарии под тип заезда',
      'Поддомен объекта на 2wel.ru',
      'Кабинет, связь с CRM и аналитика',
      'Без ограничения по числу гостей',
    ],
  },
  {
    id: 'pro',
    name: 'Про',
    price: 29900,
    constructor: 'v2',
    tagline: 'Презентация после разговора',
    setup: 'от 69 000 ₽',
    blurb:
      'После звонка собираем презентацию под желания и сомнения именно этого гостя — не общий ролик «для всех».',
    features: [
      'Всё из тарифа «Старт»',
      'Разбираем звонок из вашей CRM',
      'Выделяем желания и сомнения гостя',
      'Собираем презентацию под этот разговор',
      'Без ограничения по числу гостей',
    ],
  },
]

const BY_ID = new Map(PLAN_TIERS.map((plan) => [plan.id, plan]))

/** Старые id «Поток» / «Полный» → Про. */
const LEGACY: Record<string, PlanId> = {
  flow: 'pro',
  max: 'pro',
}

export function normalizePlanId(id: string | null | undefined): PlanId {
  const raw = String(id ?? '').trim()
  if (BY_ID.has(raw as PlanId)) return raw as PlanId
  return LEGACY[raw] ?? 'start'
}

export function planTier(id: string | null | undefined): PlanTier {
  return BY_ID.get(normalizePlanId(id)) ?? PLAN_TIERS[0]
}

export function constructorForPlan(id: string | null | undefined): PlanConstructor {
  return planTier(id).constructor
}

/** Путь конструктора по тарифу: Старт → v1, Про → v2. */
export function editorPathForPlan(
  planId: string | null | undefined,
  projectCode: string,
  templateCode: string,
): string {
  const base = `/app/projects/${projectCode}/templates/${templateCode}`
  return constructorForPlan(planId) === 'v2' ? `${base}/edit-v2` : `${base}/edit`
}

export function isPlanUpgrade(fromId: string, toId: string): boolean {
  return planTier(toId).price > planTier(fromId).price
}

const RUB = new Intl.NumberFormat('ru-RU')

export function formatRub(value: number): string {
  return RUB.format(Math.round(value))
}

/** «от 11 900» — для прайса на оффере и в кабинете. */
export function formatPriceFrom(value: number): string {
  return `от ${formatRub(value)}`
}

export function formatPeriod(startIso: string, endIso: string): string {
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }
  const start = new Date(startIso).toLocaleDateString('ru-RU', opts)
  const end = new Date(new Date(endIso).getTime() - 1).toLocaleDateString('ru-RU', opts)
  return `${start} — ${end}`
}

export function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
}

export function pluralLinks(count: number): string {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return 'ссылка'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'ссылки'
  return 'ссылок'
}
