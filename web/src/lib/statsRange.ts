export const STATS_TZ = 'Europe/Moscow'
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

export type DayRange = { from: string; to: string }

export function formatYmd(date: Date, timeZone = STATS_TZ) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

export function addCalendarDays(day: string, n: number) {
  const [y, m, d] = day.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + n))
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(
    dt.getUTCDate(),
  ).padStart(2, '0')}`
}

export function parseDay(value: string | null | undefined) {
  const s = String(value ?? '').slice(0, 10)
  if (!DAY_RE.test(s)) return null
  const [y, m, d] = s.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
  return s
}

export function defaultStatsRange(now = new Date()): DayRange {
  const to = formatYmd(now)
  return { from: addCalendarDays(to, -13), to }
}

export function monthToDateRange(now = new Date()): DayRange {
  const to = formatYmd(now)
  return { from: `${to.slice(0, 8)}01`, to }
}

export function lastDaysRange(days: number, now = new Date()): DayRange {
  const to = formatYmd(now)
  return { from: addCalendarDays(to, -(Math.max(1, days) - 1)), to }
}

export function formatRangeLabel(from: string, to: string) {
  const fmt = (ymd: string, withYear: boolean) => {
    const [y, m, d] = ymd.split('-').map(Number)
    return new Date(y, m - 1, d).toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'short',
      ...(withYear ? { year: 'numeric' } : {}),
    })
  }
  if (from === to) return fmt(from, true)
  return `${fmt(from, from.slice(0, 4) !== to.slice(0, 4))} — ${fmt(to, true)}`
}
